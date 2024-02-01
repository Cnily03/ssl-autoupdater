const tencentcloud = require("tencentcloud-sdk-nodejs");
const SSLModule = require("tencentcloud-sdk-nodejs/tencentcloud/services/ssl/v20191205/ssl_models")
const fs = require("fs");
const path = require("path");
const Timer = require("../utils/timer");
const Cache = require("../utils/cache");
const sha256 = require("../utils/utils").sha256;
const ansi2html = require("../utils/utils").ansi2html;
const MailSender = require("../utils/mail");
require("colors");

const StatusRecordType = {
    new_cert_id: "",
    old_cert_id: "",
    domain: "",
    sans: [""],
    uploaded: true,
    updated: true,
    old_deleted: true,
    comment: ""
}

/**
 * @param {string} domain
 * @param {string[] | undefined} sans
 * @param {string=} algorithm
 * @returns {{public: string, private: string}}
 */
function acmeshFounder(domain, sans, algorithm = "RSA 4096") {
    let home_path = process.env.HOME || process.env.USERPROFILE;
    let domain_dir = domain
    algorithm = algorithm.toLowerCase();
    if (algorithm.startsWith("ec-") || algorithm.startsWith("ecc")) {
        domain_dir += "_ecc";
    }

    let pub_path = path.join(home_path, ".acme.sh", domain_dir, "fullchain.cer");
    let pte_path = path.join(home_path, ".acme.sh", domain_dir, domain + ".key");
    return {
        public: fs.existsSync(pub_path) ? fs.readFileSync(pub_path, "utf-8") : undefined,
        private: fs.existsSync(pte_path) ? fs.readFileSync(pte_path, "utf-8") : undefined
    }
}

function genTimeBasedHash(identifier, random_upper = false) {
    let raw = `[${identifier}]` + Timer.now().toString() + "+" + Math.random().toString();
    let hash = sha256(raw).slice(0, 32)
    if (random_upper) hash = hash.split("").map(c => (Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase())).join("")
    return [
        hash.substring(0, 8),
        hash.substring(8, 12),
        hash.substring(12, 16),
        hash.substring(16, 20),
        hash.substring(20, 32)
    ].join("-");
}

class SSLUpdater {
    /**
     * 证书更新器
     * @param {string} secretId 腾讯云 API 密钥 ID
     * @param {string} secretKey 腾讯云 API 密钥 KEY
     * @param {Object} opts 选项
     * @param {"acme.sh" | ((domain: string, sans: string[], algorithm?: string) => {public: string, private: string})=} opts.founder
     *  根据域名和算法获取证书内容的函数，返回证书内容和私钥内容 \
     *  如果文件不存在，返回空的 JSON 对象 `{}` \
     *  如果是 acme.sh 生成的证书，可以直接填入 `"acme.sh"`
     * @param {number=} opts.force_upload_days 距离证书到期的时间小于该天数时，强制上传证书（输入`0`禁用）
     * @param {number | string | Date=} opts.timer_start 定时任务开始时间
     * @param {number=} opts.timer_interval 每隔多少毫秒进行一次检测
     * @param {MailSender=} opts.mailer 邮件发送器
     */
    constructor(secretId, secretKey, opts = {}) {
        // [+] secret check
        if (typeof secretId !== "string" || typeof secretKey !== "string")
            throw new TypeError("Parameter secretId and secretKey must be string");
        this._secretId = secretId;
        this._secretKey = secretKey;

        // [+] option format
        // opts.founder
        let founderMap = {
            "acme.sh": acmeshFounder
        }
        let defaultFounder = "acme.sh";
        if (typeof opts.founder === "function")
            /**
             * @type {(domain: string, sans: string[], algorithm?: string) => {public: string, private: string}}
             */
            this._founder = opts.founder;
        else if (typeof opts.founder !== "string") throw new TypeError("Founder must be a function or string");
        else this._founder = founderMap[opts.founder];
        if (typeof this._founder === "undefined") this._founder = founderMap[defaultFounder];
        // opts.force_upload_days
        if (typeof opts.force_upload_days === "undefined") this._force_upload_days = 0;
        else if (typeof opts.force_upload_days !== "number") throw new TypeError("force_upload_days must be a number");
        else if (opts.force_upload_days < 0) this._force_upload_days = 0;
        else this._force_upload_days = opts.force_upload_days;
        // opts.mailer
        if (typeof opts.mailer === "undefined") this.mailer = null;
        else if (!(opts.mailer instanceof MailSender)) throw new TypeError("mailer must be an instance of MailSender");
        else {
            this.mailer = opts.mailer;
            this.mailer.Template.HTML.set(fs.readFileSync(path.resolve(__dirname, "../template/qcloud.ejs"), "utf-8"));
        }


        // timer
        this.timer = new Timer(opts.timer_start || new Date(), opts.timer_interval || 24 * 60 * 60 * 1000);

        this._CLIENT = new tencentcloud.ssl.v20191205.Client({
            credential: {
                secretId: this._secretId,
                secretKey: this._secretKey,
            },
            profile: {
                httpProfile: {
                    endpoint: "ssl.tencentcloudapi.com",
                    reqMethod: "POST",
                    reqTimeout: 30,
                },
            },
        });

        this.cache = new Cache();

        const date_string = () => new Date().toLocaleString().replace(/\/(\d)([^\d])/, "/0$1$2").replace(/\/(\d)([^\d])/, "/0$1$2").replace(/\//g, "-")
        const that = this;
        this.session = {
            _session_arr: [],
            _on_session: false,
            start() {
                that.session.clear();
                that.session._on_session = true;
            },
            end() {
                that.session._on_session = false;
            },
            clear() {
                that.session._session_arr = [];
            },
            data() {
                return that.session._session_arr.join("\n");
            },
            alive() {
                return that.session._on_session;
            },
            appendLine(content, force = false) {
                if (force || that.session.alive()) that.session._session_arr.push(content);
            }
        }
        this.output = {
            log: (...args) => {
                args = [date_string().gray, `[LOG]`.gray, ...args]
                that.session.appendLine(args.join(" "));
                return console.log(...args)
            },
            info: (...args) => {
                args = [date_string().gray, `[INFO]`.blue, ...args]
                that.session.appendLine(args.join(" "));
                return console.info(...args)
            },
            warn: (...args) => {
                args = [date_string().gray, `[WARN]`.yellow, ...args]
                that.session.appendLine(args.join(" "));
                return console.warn(...args)
            },
            error: (...args) => {
                args = [date_string().gray, `[ERROR]`.red, ...args]
                that.session.appendLine(args.join(" "));
                return console.error(...args)
            },
            debug: (...args) => {
                args = [date_string().gray, `[DEBUG]`.magenta, ...args]
                that.session.appendLine(args.join(" "));
                return console.log(...args)
            },
            success: (...args) => {
                args = [date_string().gray, `[SUCCESS]`.green, ...args]
                that.session.appendLine(args.join(" "));
                return console.info(...args)
            },
            failure: (...args) => {
                args = [date_string().gray, `[FAILURE]`.red, ...args]
                that.session.appendLine(args.join(" "));
                return console.info(...args)
            }
        }

        // ID of setInterval
        this.watch_pool = new Set();
    }

    static formatCert(cert) {
        cert = cert.trim();
        cert = cert.replace(/\r\n/g, "\n");
        while (/\n\n/.test(cert)) cert = cert.replace(/\n\n/g, "\n");
        return cert;
    }

    /**
     * 获取证书列表
     * @returns {Promise<SSLModule.DescribeCertificatesResponse>}
     */
    async getCertList() {
        const that = this;
        return await new Promise((resolve, reject) => {
            that._CLIENT.DescribeCertificates({
                "Limit": 10,
                "Offset": 0
            }).then(data => {
                resolve(data);
            }).catch(err => { reject(err) });
        })
    }
    /**
     * 获取证书详细信息.
     * @param {string} cert_id 证书 ID
     * @returns {Promise<SSLModule.DescribeCertificateDetailResponse>}
     */
    async getCertDetail(cert_id) {
        const that = this;
        return await new Promise((resolve, reject) => {
            that._CLIENT.DescribeCertificateDetail({
                CertificateId: cert_id
            }).then(data => {
                resolve(data);
            }).catch(err => { reject(err) });
        })
    }

    /**
     * 上传证书
     * @param {string} pub_cer 公钥内容
     * @param {string} pte_key 私钥内容
     * @param {Object} others
     * @param {"SVR" | "CA"=} others.type 证书类型
     * @param {string=} others.alias 证书备注
     * @param {number=} others.project_id 项目ID
     * @param {"CLB" | "CDN" | "WAF" | "LIVE" | "DDOS"=} others.cert_use 证书用途
     * @param {{key:string, value: string}[]=} others.tags 证书标签
     * @param {boolean=} others.repeatable 是否允许上传相同证书
     * @returns {Promise<SSLModule.UploadCertificateResponse>}
     */
    async uploadCert(pub_cer, pte_key, others = {}) {
        const that = this;
        return await new Promise((resolve, reject) => {
            that._CLIENT.UploadCertificate({
                CertificatePublicKey: pub_cer,
                CertificatePrivateKey: pte_key,
                CertificateType: others.type || "SVR",
                Alias: others.alias || "上传证书 (自动)",
                ProjectId: others.project_id || 0,
                CertificateUse: others.cert_use,
                Tags: others.tags.map(tag => ({ TagKey: tag.key, TagValue: tag.value })) || [],
                Repeatable: others.repeatable || false
            }).then(data => {
                resolve(data);
            }).catch(err => { reject(err) });
        })
    }

    /**
     * 获取证书绑定的资源
     * @param {string | string[]} cert_ids 证书 ID
     * @returns {Promise<{[cert_id: string]: {
     *  CLB?: Array<SSLModule.ClbInstanceList>,
     *  CDN?: Array<SSLModule.CdnInstanceList>,
     *  WAF?: Array<SSLModule.WafInstanceList>,
     *  DDOS?: Array<SSLModule.DdosInstanceList>,
     *  LIVE?: Array<SSLModule.LiveInstanceList>,
     *  VOD?: Array<SSLModule.VODInstanceList>,
     *  TKE?: Array<SSLModule.TkeInstanceList>,
     *  APIGATEWAY?: Array<SSLModule.ApiGatewayInstanceList>,
     *  TCB?: Array<SSLModule.TCBInstanceList>,
     *  TEO?: Array<SSLModule.TeoInstanceList>
     * }}>}
     */
    async getBindResourcesOfCerts(cert_ids) {
        const that = this;
        cert_ids = [cert_ids].flat();
        /**
         * @type {SSLModule.CreateCertificateBindResourceSyncTaskResponse}
         */
        let resp = await new Promise((resolve, reject) => {
            that._CLIENT.CreateCertificateBindResourceSyncTask({
                CertificateIds: cert_ids,
                IsCache: 1 // TODO: add option for whether to use cache
            }).then(data => {
                resolve(data);
            }).catch(err => { reject(err) });
        })

        let promise_pool = [];
        let result = {}
        const TTL = 2 * 60 * 1000;
        const DDL = Timer.now() + TTL;

        for (let task_info of resp.CertTaskIds) {
            const p = new Promise((resolve, reject) => {
                let interval_func
                let interval_id = setInterval(interval_func = async () => {
                    if (Timer.now() > DDL) { // timeout
                        clearInterval(interval_id);
                        result[task_info.CertId] = null;
                        return resolve()
                    }
                    /**
                     * @type {SSLModule.DescribeCertificateBindResourceTaskDetailResponse}
                     */
                    let task_resp = await new Promise((_resolve, _reject) => {
                        that._CLIENT.DescribeCertificateBindResourceTaskDetail({
                            TaskId: task_info.TaskId
                        }).then(data => {
                            _resolve(data);
                        }).catch(err => { _reject(err) });
                    }).catch(err => { that.output.error(err); return null; })

                    if (task_resp === null) return;
                    if (task_resp.Status === 0) return; // querying
                    if (task_resp.Status === 2) { // failed
                        clearInterval(interval_id);
                        result[task_info.CertId] = null;
                        return resolve()
                    }
                    if (task_resp.Status === 1) { // success
                        clearInterval(interval_id);
                        let res = {}
                        for (let k in task_resp) {
                            if (!Object.prototype.hasOwnProperty.call(task_resp, k)) continue;
                            if (!Array.isArray(task_resp[k])) continue;
                            if (task_resp[k].length === 0) continue;
                            let val = task_resp[k].filter(item => {
                                if (Array.isArray(item.InstanceList)) return item.InstanceList.length > 0;
                                else if (Array.isArray(item.Environments)) return item.Environments.length > 0;
                                else {
                                    that.output.log(`Found exception for ${k}:`, item);
                                    return false;
                                }
                            })
                            if (val.length === 0) continue;
                            res[k] = val;
                        }
                        result[task_info.CertId] = res;
                        return resolve()
                    }
                }, 10 * 1000)
                setTimeout(() => {
                    interval_func();
                }, 3 * 1000)
            })
            promise_pool.push(p);
        }
        await Promise.all(promise_pool);
        return result;
    }

    /**
     * 更新证书资源
     * @param {string} new_cert_id 新证书 ID
     * @param {string} old_cert_id 旧证书 ID
     * @param {Object} others
     * @param {("clb" | "cdn" | "waf" | "live" | "ddos" | "teo" | "apigateway" | "vod" | "tke" | "tcb")[]=} others.resources 需要更新的资源类型
     * @param {Array<SSLModule.ResourceTypeRegions>=} others.regions 需要更新的地域列表
     * @returns {Promise<SSLModule.UpdateCertificateInstanceResponse>}
     */
    async updateCertInstance(new_cert_id, old_cert_id, others = {}) {
        const that = this;
        if (!Array.isArray(others.resources))
            others.resources = ["clb", "cdn", "waf", "live", "ddos", "teo", "apigateway", "vod", "tke", "tcb"]

        return await new Promise((resolve, reject) => {
            that._CLIENT.UpdateCertificateInstance({
                CertificateId: new_cert_id,
                OldCertificateId: old_cert_id,
                ResourceTypes: others.resources,
                ResourceTypesRegions: others.regions
            })
        }).then(data => {
            resolve(data);
        }).catch(err => { reject(err) })
    }

    /**
     * 删除证书
     * @param {string} cert_id 证书 ID
     * @returns {Promise<SSLModule.DeleteCertificateResponse>}
     */
    async deleteCert(cert_id) {
        const that = this;
        return await new Promise((resolve, reject) => {
            that._CLIENT.DeleteCertificate({
                CertificateId: cert_id
            }).then(data => {
                resolve(data);
            }).catch(err => { reject(err) });
        })
    }

    /**
     * 自动监测域名，并更新证书
     * @param {string | string[]=} domains 检测的域名列表（域名为主域名，不包括 SANS），为空则表示所有域名、不进行过滤
     */
    async watch(domains) {
        const that = this;
        // check parameter
        if (typeof domains === "undefined") domains = [];
        if (!Array.isArray(domains)) domains = [domains];
        domains.forEach(d => { if (typeof d !== "string") throw new TypeError("Domains must be string or array of string") });

        let func, on_running = false, trigger_cnt = 0;
        const itvid = setInterval(func = async () => {
            if (on_running) return;
            if (that.timer.is_expired()) {
                that.timer.set_future();

                on_running = true;
                that.session.start();

                let trigger_id = genTimeBasedHash("QCloud SSL Updater", false);
                that.output.log(`[#${trigger_cnt}] Timer triggered, ID: ${trigger_id}`);
                let status_record_array = await that._triggerUpdate(domains).catch(err => { that.output.error(err); })
                that.output.log(`[#${trigger_cnt}] Trigger complete`);

                that.session.end();
                on_running = false;

                let templateArgs = that._genTemplateArgs(trigger_id, status_record_array, that.session.data());
                await that.mailer.send("[SSL Updater] 证书更新结果通知",
                    "html", that.mailer.Template.HTML.render(templateArgs)
                ).catch(err => { that.output.error(err); })

                ++trigger_cnt;
            }
        }, 10 * 1000)
        func();

        this.watch_pool.add(itvid);
        return itvid;
    }

    /**
     * 触发更新
     * @param {string[]=} domains
     */
    async _triggerUpdate(domains) {
        /**
         * @type {{[cert_id: string]: StatusRecordType}}
         */
        let status_record_json = {};
        try {
            const detectAll = typeof domains === "undefined" || domains.length === 0;
            // pull cert info
            let list_resp = await this.getCertList();
            let certificates = detectAll ? list_resp.Certificates : list_resp.Certificates.filter(cert => domains.includes(cert.Domain))

            let need_update_certificates = []; // [{ cert_info, upload_resp }]

            for (let cert_info of certificates) {
                if (typeof cert_info.CertificateId !== "string") continue; // invalid cert info

                let need_continue = this._force_upload_days > 0 && (new Date(cert_info.CertEndTime).getTime() - Timer.now() < this._force_upload_days * 24 * 60 * 60 * 1000)

                const { public: local_pubcer, private: local_ptekey } = this._founder(cert_info.Domain, cert_info.CertSANs, cert_info.EncryptAlgorithm) || {};
                if (typeof local_pubcer !== "string" || typeof local_ptekey !== "string") {
                    // file not found
                    this.output.warn(`No certificate file found for domain ${cert_info.Domain}, skip`);
                    continue;
                }

                const local_pubcer_sha256 = sha256(SSLUpdater.formatCert(local_pubcer));
                const local_ptekey_sha256 = sha256(SSLUpdater.formatCert(local_ptekey));

                let is_local_changed = this.cache.is_changed([cert_info.Domain, cert_info.CertSANs, cert_info.EncryptAlgorithm], {
                    public: local_pubcer_sha256,
                    private: local_ptekey_sha256
                })

                need_continue = need_continue || is_local_changed;

                if (!need_continue) {
                    this.output.info(`Domain ${cert_info.Domain} checked, no need to update`);
                    continue;
                }

                // get detail
                let detail_resp = await this.getCertDetail(cert_info.CertificateId);
                if (typeof detail_resp.From === "string" && detail_resp.From !== "upload" && detail_resp.From !== "") {
                    // not uploaded by user, skip
                    this.output.info(`Certificate ${cert_info.CertificateId} for domain ${cert_info.Domain} is not uploaded by user, skip`);
                    continue;
                }

                const remote_pubcer_sha256 = typeof detail_resp.CertificatePublicKey === "string" ?
                    sha256(SSLUpdater.formatCert(detail_resp.CertificatePublicKey)) : '';
                const remote_ptekey_sha256 = typeof detail_resp.CertificatePrivateKey === "string" ?
                    sha256(SSLUpdater.formatCert(detail_resp.CertificatePrivateKey)) : '';

                let is_remote_different = remote_pubcer_sha256 !== local_pubcer_sha256 || remote_ptekey_sha256 !== local_ptekey_sha256;

                if (!is_remote_different) {
                    // cert content no change
                    this.output.info(`Domain ${cert_info.Domain} with certificate ${cert_info.CertificateId} has no change, skip`);
                    continue;
                }

                // [+] start recording
                status_record_json[cert_info.CertificateId] = {
                    new_cert_id: null,
                    old_cert_id: cert_info.CertificateId,
                    domain: cert_info.Domain,
                    sans: cert_info.CertSANs,
                    uploaded: null, // null 表示未进行, false 表示失败, true 表示成功
                    updated: null,
                    old_deleted: null,
                    comment: ''
                }

                // upload
                status_record_json[cert_info.CertificateId].uploaded = false;
                let upload_resp = await this.uploadCert(local_pubcer, local_ptekey, {
                    type: cert_info.CertificateType,
                    alias: cert_info.Alias,
                    project_id: Number(cert_info.ProjectId),
                    tags: cert_info.Tags,
                    repeatable: false
                })

                status_record_json[cert_info.CertificateId].uploaded = true;
                status_record_json[cert_info.CertificateId].new_cert_id = upload_resp.CertificateId;

                if (upload_resp.CertificateId === cert_info.CertificateId) {
                    // cert content no change (same cert id)
                    this.output.info(`Same certificate ${upload_resp.CertificateId} (domain: ${cert_info.Domain}) uploaded, skip`);
                    continue;
                }

                this.output.success(`New certificate ${upload_resp.CertificateId} (domain: ${cert_info.Domain}) uploaded`)

                // upload complete
                this.cache.set([cert_info.Domain, cert_info.CertSANs, cert_info.EncryptAlgorithm], {
                    public: local_pubcer_sha256,
                    private: local_ptekey_sha256
                })

                need_update_certificates.push({ cert_info, upload_resp });
            }

            if (need_update_certificates.length === 0) {
                this.output.info("No certificate needs to be updated, nothing to do");
                return Object.values(status_record_json);
            }

            // fetch bound resources
            this.output.log("Fetching bound resources...");
            let bind_resources = await this.getBindResourcesOfCerts(need_update_certificates.map(cert => cert.cert_info.CertificateId));

            for (let { cert_info, upload_resp } of need_update_certificates) {
                let resource_types = Object.keys(bind_resources[cert_info.CertificateId] || {}).map(k => k.toLowerCase());
                let resource_regions = []
                for (let k in bind_resources[cert_info.CertificateId]) {
                    if (!Object.prototype.hasOwnProperty.call(bind_resources[cert_info.CertificateId], k)) continue;
                    let v = bind_resources[cert_info.CertificateId][k];
                    let r = v.map(item => item.Region).filter(item => typeof item === "string");
                    if (r.length === 0) continue;
                    resource_regions.push({
                        ResourceType: k,
                        Regions: r
                    })
                }

                // update
                status_record_json[cert_info.CertificateId].updated = false;
                this.output.log(`Updating resources for certificate ${cert_info.CertificateId} (domain: ${cert_info.Domain}) (${cert_info.Alias})...`);
                let update_resp = await this.updateCertInstance(upload_resp.CertificateId, cert_info.CertificateId, {
                    resources: resource_types,
                    regions: resource_regions
                })

                if (update_resp.DeployStatus !== 1) {
                    this.output.failure(`Failed to update resources for certificate ${cert_info.CertificateId} (domain: ${cert_info.Domain}) (${cert_info.Alias})`);
                }

                status_record_json[cert_info.CertificateId].updated = true;
                this.output.success(`Successfully updated resources for certificate ${cert_info.CertificateId} (domain: ${cert_info.Domain}) (${cert_info.Alias})`);

                // delete old cert
                status_record_json[cert_info.CertificateId].old_deleted = false;
                this.output.log(`Deleting old certificate ${cert_info.CertificateId} (domain: ${cert_info.Domain})...`);
                let del_resp = await this.deleteCert(cert_info.CertificateId);
                if (del_resp.DeleteResult) {
                    status_record_json[cert_info.CertificateId].old_deleted = true;
                    this.output.info(`Certificate ${cert_info.CertificateId} (domain: ${cert_info.Domain}) Deleted`);
                }
            }

        } catch (err) { this.output.error(err); }
        return Object.values(status_record_json)
    }

    /**
     * 生成邮件模板参数
     * @param {string} trigger_id
     * @param {StatusRecordType[]} status_record_array
     * @param {string} terminal_output
     * @returns {Object}
     */
    _genTemplateArgs(trigger_id, status_record_array, terminal_output) {
        let data_array = status_record_array.map(item => {
            // new_cert_id
            if (item["new_cert_id"] === null)
                item["new_cert_id"] = {
                    color: "error",
                    text: "获取失败"
                }
            else item["new_cert_id"] = {
                color: "gray",
                text: item["new_cert_id"]
            }

            // old_cert_id
            item["old_cert_id"] = {
                color: "gray",
                text: item["old_cert_id"]
            }

            // domain
            item["domain"] = {
                color: "gray",
                text: item["domain"]
            }

            // sans
            if (!Array.isArray(item["sans"]))
                item["sans"] = {
                    color: "error",
                    text: "获取失败"
                }
            else if (item["sans"].length === 0)
                item["sans"] = {
                    color: "light",
                    text: "无"
                }
            else item["sans"] = {
                color: "gray",
                text: item["sans"].join(", ")
            }

            // uploaded
            if (item["uploaded"] === null)
                item["uploaded"] = {
                    color: "warn",
                    text: "未进行"
                }
            else if (item["uploaded"] === false)
                item["uploaded"] = {
                    color: "error",
                    text: "上传失败"
                }
            else item["uploaded"] = {
                color: "success",
                text: "上传成功"
            }

            // updated
            if (item["updated"] === null)
                item["updated"] = {
                    color: "warn",
                    text: "未进行"
                }
            else if (item["updated"] === false)
                item["updated"] = {
                    color: "error",
                    text: "部署失败"
                }
            else item["updated"] = {
                color: "success",
                text: "部署成功"
            }

            // old_deleted
            if (item["old_deleted"] === null)
                item["old_deleted"] = {
                    color: "warn",
                    text: "未删除"
                }
            else if (item["old_deleted"] === false)
                item["old_deleted"] = {
                    color: "error",
                    text: "删除失败"
                }
            else item["old_deleted"] = {
                color: "success",
                text: "删除成功"
            }

            // comment
            if (item["comment"] === "")
                item["comment"] = {
                    color: "light",
                    text: "无"
                }
            else item["comment"] = {
                color: "gray",
                text: item["comment"]
            }

            return item;
        })

        // terminal_output
        let terminal_html = ansi2html(terminal_output);

        return {
            trigger_id: trigger_id,
            data: data_array,
            output: terminal_html
        }
    }
}
