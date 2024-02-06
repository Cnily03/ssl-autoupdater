// import tencentcloud from "tencentcloud-sdk-nodejs" // compile error
import { ssl } from "tencentcloud-sdk-nodejs"
import SSLModule from "tencentcloud-sdk-nodejs/tencentcloud/services/ssl/v20191205/ssl_models"
import { Client as QCloudSSLClient } from "tencentcloud-sdk-nodejs/tencentcloud/services/ssl/v20191205/ssl_client";
import fs from "fs"
import path from "path"
import Timer from "@/utils/timer"
import { sha256, ansi2html } from "@/utils/utils"
import MailSender from "@/utils/mail-sender"
import SSLUpdater, { SSLUpdaterOptions } from "@/components/ssl-updater"
import "colors"

type StatusRecord = {
    new_cert_id: string | null,
    old_cert_id: string,
    domain: string,
    sans: string[],
    uploaded: boolean | null,
    updated: boolean | null,
    old_deleted: boolean | null,
    comment: string
}

type Colorify<T> = {
    [k in keyof T]: {
        color: string;
        text: string;
    }
}

type UploadCertOptions = {
    /**
     * 证书类型
     */
    type?: "SVR" | "CA",
    /**
     * 证书备注
     */
    alias?: string,
    /**
     * 项目 ID
     */
    project_id?: number,
    /**
     * 证书用途
     */
    cert_use?: "CLB" | "CDN" | "WAF" | "LIVE" | "DDOS",
    /**
     * 证书标签
     */
    tags?: ({ key: string, value: string })[]
    /**
     * 是否允许上传相同证书
     */
    repeatable?: boolean
}

type ResourceType = "clb" | "cdn" | "waf" | "live" | "ddos" | "teo" | "apigateway" | "vod" | "tke" | "tcb"

type updateCertOptions = {
    resources?: ResourceType[],
    regions?: SSLModule.ResourceTypeRegions[]
}

type BindResource = {
    CLB: Array<SSLModule.ClbInstanceList>,
    CDN: Array<SSLModule.CdnInstanceList>,
    WAF: Array<SSLModule.WafInstanceList>,
    DDOS: Array<SSLModule.DdosInstanceList>,
    LIVE: Array<SSLModule.LiveInstanceList>,
    VOD: Array<SSLModule.VODInstanceList>,
    TKE: Array<SSLModule.TkeInstanceList>,
    APIGATEWAY: Array<SSLModule.ApiGatewayInstanceList>,
    TCB: Array<SSLModule.TCBInstanceList>,
    TEO: Array<SSLModule.TeoInstanceList>
}
type BindResourceList = {
    [cert_id: string]: Partial<BindResource> | null
}

namespace FixedSSLModule {
    export interface DescribeCertificatesResponse {
        /**
         * 总数量。注意：此字段可能返回 null，表示取不到有效值。
         */
        TotalCount?: number;
        /**
         * 列表。注意：此字段可能返回 null，表示取不到有效值。
         */
        Certificates?: Array<SSLModule.Certificates & { CertSANs?: string[] }>;
        /**
         * 唯一请求 ID，每次请求都会返回。定位问题时需要提供该次请求的 RequestId。
         */
        RequestId?: string;
    }
}

export class QCloudSSLUpdater extends SSLUpdater {

    private _CLIENT: QCloudSSLClient;

    /**
     * 腾讯云证书更新器
     * @param secretId 腾讯云 secretId
     * @param secretKey 腾讯云 secretKey
     */
    constructor(secretId: string, secretKey: string, opts: SSLUpdaterOptions = {}) {
        super("Tencent", opts)

        // mailer
        if (this.mailer instanceof MailSender) {
            this.mailer.Template.HTML.set(fs.readFileSync(path.resolve(__dirname, "../template/qcloud.ejs"), "utf-8"));
        }

        this._CLIENT = new ssl.v20191205.Client({
            credential: {
                secretId: secretId,
                secretKey: secretKey,
            },
            profile: {
                httpProfile: {
                    endpoint: "ssl.tencentcloudapi.com",
                    reqMethod: "POST",
                    reqTimeout: 30,
                },
            },
        });
    }

    /**
     * 获取证书列表
     */
    async getCertList(): Promise<FixedSSLModule.DescribeCertificatesResponse> {
        const that = this;
        return await new Promise((resolve, reject) => {
            that._CLIENT.DescribeCertificates({
                "Limit": 10,
                "Offset": 0
            }).then(data => {
                resolve(data);
            }).catch(e => reject(e));
        })
    }

    /**
     * 获取证书详细信息
     */
    async getCertDetail(cert_id: string): Promise<SSLModule.DescribeCertificateDetailResponse> {
        const that = this;
        return await new Promise((resolve, reject) => {
            that._CLIENT.DescribeCertificateDetail({
                CertificateId: cert_id
            }).then(data => {
                resolve(data);
            }).catch(e => reject(e));
        })
    }

    /**
     * 上传证书
     */
    async uploadCert(pub_cer: string, pte_key: string, others: UploadCertOptions = {}): Promise<SSLModule.UploadCertificateResponse> {
        const that = this;
        return await new Promise((resolve, reject) => {
            that._CLIENT.UploadCertificate({
                CertificatePublicKey: pub_cer,
                CertificatePrivateKey: pte_key,
                CertificateType: others.type || "SVR",
                Alias: others.alias || "上传证书 (自动)",
                ProjectId: others.project_id || 0,
                CertificateUse: others.cert_use,
                Tags: (others.tags || []).map(tag => ({ TagKey: tag.key, TagValue: tag.value })),
                Repeatable: others.repeatable || false
            }).then(data => {
                resolve(data);
            }).catch(e => reject(e));
        })
    }

    /**
     * 获取证书绑定的资源
     * @param cert_ids 证书 ID
     */
    async getBindResourcesOfCerts(cert_ids: string | string[]): Promise<BindResourceList> {
        const that = this;
        cert_ids = [cert_ids].flat();

        let resp = await new Promise((resolve, reject) => {
            that._CLIENT.CreateCertificateBindResourceSyncTask({
                CertificateIds: cert_ids as string[],
                IsCache: 1 // TODO: add option for whether to use cache
            }).then(data => {
                resolve(data);
            }).catch(e => reject(e));
        }) as SSLModule.CreateCertificateBindResourceSyncTaskResponse

        let promise_pool: Promise<any>[] = [];
        let result: BindResourceList = {}
        const TTL = 2 * 60 * 1000;
        const DDL = Timer.now() + TTL;

        for (let task_info of (resp.CertTaskIds || [])) {
            const p = new Promise((resolve, reject) => {
                let interval_func: () => any;
                let interval_id = setInterval(interval_func = async () => {
                    if (Timer.now() > DDL) { // timeout
                        clearInterval(interval_id);
                        if (typeof task_info.CertId === "string") result[task_info.CertId] = null;
                        return resolve(void 0);
                    }

                    if (typeof task_info.TaskId === "undefined") return resolve(void 0);

                    let task_resp = await new Promise((_resolve, _reject) => {
                        that._CLIENT.DescribeCertificateBindResourceTaskDetail({
                            TaskId: task_info.TaskId as string
                        }).then(data => {
                            _resolve(data);
                        }).catch(err => { _reject(err) });
                    }).catch(err => { that.output.error(err); return null; }) as SSLModule.DescribeCertificateBindResourceTaskDetailResponse | null;

                    if (task_resp === null) return;
                    else if (task_resp.Status === 0) return; // querying
                    else if (task_resp.Status === 2) { // failed
                        clearInterval(interval_id);
                        if (typeof task_info.CertId === "string") result[task_info.CertId] = null;
                        return resolve(void 0);
                    }
                    else if (task_resp.Status === 1) { // success
                        clearInterval(interval_id);
                        let res: any = {}
                        let k: keyof typeof task_resp
                        for (k in task_resp) {
                            if (!Object.prototype.hasOwnProperty.call(task_resp, k)) continue;
                            if (!Array.isArray(task_resp[k])) continue;
                            let task_value: any = task_resp[k as keyof BindResource];
                            if (typeof task_value === "undefined" || task_value.length === 0) continue;
                            else {
                                let val = task_value.filter((item: any) => {
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
                        }
                        if (typeof task_info.CertId === "string") result[task_info.CertId] = null;
                        return resolve(void 0);
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
     * @param new_cert_id 新证书 ID
     * @param old_cert_id 旧证书 ID
     * @param others.resources 需要更新的资源类型
     * @param others.regions 需要更新的地域列表
     */
    async updateCertInstance(new_cert_id: string, old_cert_id: string, others: updateCertOptions = {}) {
        const that = this;
        let defaultResources = ["clb", "cdn", "waf", "live", "ddos", "teo", "apigateway", "vod", "tke", "tcb"]

        return await new Promise((resolve, reject) => {
            that._CLIENT.UpdateCertificateInstance({
                CertificateId: new_cert_id,
                OldCertificateId: old_cert_id,
                ResourceTypes: others.resources || defaultResources,
                ResourceTypesRegions: others.regions
            }).then(data => {
                resolve(data);
            }).catch(err => { reject(err) })
        }) as Promise<SSLModule.UpdateCertificateInstanceResponse>
    }

    /**
     * 删除证书
     * @param cert_id 证书 ID
     */
    async deleteCert(cert_id: string) {
        const that = this;
        return await new Promise((resolve, reject) => {
            that._CLIENT.DeleteCertificate({
                CertificateId: cert_id
            }).then(data => {
                resolve(data);
            }).catch(err => { reject(err) });
        }) as Promise<SSLModule.DeleteCertificateResponse>
    }

    /**
     * 触发更新
     * @param domains 检测的域名列表（留空则检测所有）
     */
    async triggerUpdate(domains: string[]): Promise<StatusRecord[]> {
        let status_record_json: { [cert_id: string]: StatusRecord } = {};
        try {
            const detectAll = typeof domains === "undefined" || domains.length === 0;
            this.output.log("OPTION", "DETECT_ALL", detectAll ? "ON" : "OFF");

            // get cert list
            this.output.log("STEP", "GET_CERT_LIST", "START")
            let list_resp = await this.getCertList();
            if (typeof list_resp.Certificates === "undefined") {
                this.output.log("STEP", "GET_CERT_LIST", "FAILED".red)
                throw new Error("Failed to get certificate list");
            }
            this.output.log("STEP", "GET_CERT_LIST", "DONE")

            let cert_list = detectAll ?
                list_resp.Certificates :
                list_resp.Certificates.filter(cert => domains.includes(cert.Domain))
            this.output.log("DATA", "CERT_LIST", "|", "COUNT[TOTAL]", list_resp.TotalCount, "|", "COUNT[FILTERED]", cert_list.length)

            let need_update_certificates = []; // [{ cert_info, upload_resp }]

            for (let cert_info of cert_list) {
                this.output.log("STEP", "UPLOAD", "START",
                    "|", "OLD_CERT_ID", cert_info.CertificateId,
                    "|", "DOMAIN", cert_info.Domain,
                    "|", "ALIAS", cert_info.Alias);
                if (typeof cert_info.CertificateId !== "string") {
                    this.output.log("STEP", "UPLOAD", "SKIP", "|", "REASON", "INVALID_CERT_ID")
                    this.output.log("Invalid certificate id, skip")
                    continue; // invalid cert info
                }

                let need_continue = this._force_upload_days > 0 && (new Date(cert_info.CertEndTime).getTime() - Timer.now() < this._force_upload_days * 24 * 60 * 60 * 1000)

                if (!need_continue) {
                    this.output.log("STEP", "UPLOAD", "SKIP", "|", "REASON", "SCHEDULE_NOT_MATCH")
                    this.output.info(`Domain ${cert_info.Domain} doesn't match schedule, skip`);
                    continue;
                }

                const { public: local_pubcer, private: local_ptekey } = this._founder(cert_info.Domain, cert_info.CertSANs || [], cert_info.EncryptAlgorithm) || {};
                if (typeof local_pubcer !== "string" || typeof local_ptekey !== "string") {
                    // file not found
                    this.output.log("FILE", "LOCAL_CERT_BOTH", "NOT_FOUND".yellow)
                    this.output.warn(`No certificate file found for domain ${cert_info.Domain}, skip`);
                    this.output.log("STEP", "UPLOAD", "SKIP", "|", "REASON", "LOCAL_CERT_NOT_FOUND")
                    continue;
                }

                const local_pubcer_sha256 = sha256(SSLUpdater.formatCert(local_pubcer));
                const local_ptekey_sha256 = sha256(SSLUpdater.formatCert(local_ptekey));

                let is_local_changed = this.cache.is_changed([cert_info.Domain, cert_info.CertSANs, cert_info.EncryptAlgorithm], {
                    public: local_pubcer_sha256,
                    private: local_ptekey_sha256
                })

                if (!is_local_changed) {
                    this.output.log("STEP", "UPLOAD", "SKIP", "|", "REASON", "LOCAL_CERT_NO_CHANGE")
                    this.output.info(`Local certificate for domain ${cert_info.Domain} has no change, no need to update`);
                    continue;
                }

                // get detail
                this.output.log("STEP", "UPLOAD[GET_OLD_DETAIL]", "START", "|", "CERT_ID", cert_info.CertificateId);
                let detail_resp = await this.getCertDetail(cert_info.CertificateId);
                this.output.log("STEP", "UPLOAD[GET_OLD_DETAIL]", "DONE")
                if (typeof detail_resp.From === "string" && detail_resp.From !== "upload" && detail_resp.From !== "") {
                    // not uploaded by user, skip
                    this.output.log("STEP", "UPLOAD", "SKIP", "|", "REASON", "NOT_USER_UPLOADED")
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
                    this.output.log("STEP", "UPLOAD", "SKIP", "|", "REASON", "REMOTE_SAME_AS_LOCAL")
                    this.output.info(`Domain ${cert_info.Domain} with certificate ${cert_info.CertificateId} has no change, skip`);
                    continue;
                }

                // [+] start recording
                this.output.log("PROCESS", "START_RECORD");
                status_record_json[cert_info.CertificateId] = {
                    new_cert_id: null, // null 表示获取失败
                    old_cert_id: cert_info.CertificateId,
                    domain: cert_info.Domain,
                    sans: cert_info.CertSANs || [],
                    uploaded: null, // null 表示未进行, false 表示失败, true 表示成功
                    updated: null,
                    old_deleted: null,
                    comment: ''
                }

                // upload
                this.output.log("STEP", "UPLOAD[UPLOAD_NEW_CERT]", "START")
                status_record_json[cert_info.CertificateId].uploaded = false;
                let upload_resp = await this.uploadCert(local_pubcer, local_ptekey, {
                    type: cert_info.CertificateType as UploadCertOptions["type"],
                    alias: cert_info.Alias,
                    project_id: Number(cert_info.ProjectId),
                    tags: cert_info.Tags.map(tag => ({ key: tag.TagKey, value: tag.TagValue })),
                    repeatable: false
                })
                status_record_json[cert_info.CertificateId].uploaded = true;
                status_record_json[cert_info.CertificateId].new_cert_id = upload_resp.CertificateId || null;
                this.output.log("STEP", "UPLOAD[UPLOAD_NEW_CERT]", "DONE", "|", "NEW_CERT_ID", upload_resp.CertificateId);

                if (upload_resp.CertificateId === cert_info.CertificateId) {
                    // cert content no change (same cert id)
                    this.output.log("STEP", "UPLOAD", "SKIP", "|", "REASON", "SAME_CERT_ID")
                    this.output.info(`Same certificate ${upload_resp.CertificateId} (domain: ${cert_info.Domain}) uploaded, skip`);
                    continue;
                }

                this.output.success(`New certificate ${upload_resp.CertificateId} (domain: ${cert_info.Domain}) uploaded`)

                // upload complete
                this.output.log("PROCESS", "CACHE");
                this.cache.set([cert_info.Domain, cert_info.CertSANs, cert_info.EncryptAlgorithm], {
                    public: local_pubcer_sha256,
                    private: local_ptekey_sha256
                })

                need_update_certificates.push({ cert_info, upload_resp });
                this.output.log("STEP", "UPLOAD", "DONE");
            }

            this.output.log("DATA", "NEED_UPDATE_CERTIFICATES", "|", "COUNT", need_update_certificates.length)

            if (need_update_certificates.length === 0) {
                this.output.info("No certificate needs to be updated, nothing to do");
                return Object.values(status_record_json);
            }

            // fetch bound resources
            this.output.log("STEP", "FETCH_BIND_RESOURCES", "START", "|", "CERT_ID", "ALL");
            this.output.log("Fetching bound resources...");
            let bind_resources = await this.getBindResourcesOfCerts(need_update_certificates.map(cert => cert.cert_info.CertificateId));
            this.output.log("STEP", "FETCH_BIND_RESOURCES", "DONE");

            for (let { cert_info, upload_resp } of need_update_certificates) {
                this.output.log("STEP", "UPDATE", "START",
                    "|", "NEW_CERT_ID", upload_resp.CertificateId,
                    "|", "OLD_CERT_ID", cert_info.CertificateId,
                    "|", "DOMAIN", cert_info.Domain,
                    "|", "ALIAS", cert_info.Alias);

                if (typeof upload_resp.CertificateId !== "string") {
                    this.output.log("STEP", "UPDATE", "SKIP", "|", "REASON", "INVALID_CERT_ID")
                    continue; // invalid upload response
                }

                let resource_types = Object.keys(bind_resources[cert_info.CertificateId] || {}).map(k => k.toLowerCase());
                let resource_regions = []
                let bind_src = bind_resources[cert_info.CertificateId];
                if (bind_src === null) {
                    this.output.log("STEP", "UPDATE", "SKIP", "|", "REASON", "NO_BIND_RESOURCE")
                    continue;
                }
                for (let k in bind_src) {
                    if (!Object.prototype.hasOwnProperty.call(bind_src, k)) continue;
                    let v = bind_src[k as keyof BindResource];
                    if (typeof v === "undefined") continue;
                    let r = v.map((item: any) => item.Region).filter(item => typeof item === "string");
                    if (r.length === 0) continue;
                    resource_regions.push({
                        ResourceType: k,
                        Regions: r
                    })
                }

                // update
                this.output.log("STEP", "UPDATE[UPDATE_CERT_INSTANCE]", "START");
                this.output.log(`Updating resources for certificate ${cert_info.CertificateId} (domain: ${cert_info.Domain}) (${cert_info.Alias})...`);
                status_record_json[cert_info.CertificateId].updated = false;
                let update_resp = await this.updateCertInstance(upload_resp.CertificateId, cert_info.CertificateId, {
                    resources: resource_types as ResourceType[],
                    regions: resource_regions
                })
                this.output.log("STEP", "UPDATE[UPDATE_CERT_INSTANCE]", "DONE", "|", "STATUS", update_resp.DeployStatus);

                if (update_resp.DeployStatus !== 1) {
                    this.output.log("STEP", "UPDATE", "SKIP", "|", "REASON", "DEPLOY_FAILED".red)
                    this.output.failure(`Failed to update resources for certificate ${cert_info.CertificateId} (domain: ${cert_info.Domain}) (${cert_info.Alias})`);
                    continue;
                }

                this.output.log("STEP", "UPDATE", "DONE");
                status_record_json[cert_info.CertificateId].updated = true;
                this.output.success(`Successfully updated resources for certificate ${cert_info.CertificateId} (domain: ${cert_info.Domain}) (${cert_info.Alias})`);

                // delete old cert
                this.output.log("STEP", "DELETE_OLD_CERT", "START", "|", "OLD_CERT_ID", cert_info.CertificateId);
                status_record_json[cert_info.CertificateId].old_deleted = false;
                this.output.log(`Deleting old certificate ${cert_info.CertificateId} (domain: ${cert_info.Domain})...`);
                let del_resp = await this.deleteCert(cert_info.CertificateId);
                this.output.log("STEP", "DELETE_OLD_CERT", "DONE", "|", "STATUS", del_resp.DeleteResult ? "SUCCESS" : "FAILED".red);
                if (del_resp.DeleteResult) {
                    status_record_json[cert_info.CertificateId].old_deleted = true;
                    this.output.info(`Certificate ${cert_info.CertificateId} (domain: ${cert_info.Domain}) Deleted`);
                } else {
                    this.output.failure(`Failed to delete certificate ${cert_info.CertificateId} (domain: ${cert_info.Domain})`);
                }
            }
        } catch (err) { this.output.error(err); }
        return Object.values(status_record_json)
    }

    async sendMsg(title: string, content: string): Promise<any> {
        if (!content) return;
        if (this.mailer) {
            await this.mailer.send(title, "html", content)
                .catch(err => { this.output.error(err); })
        } else {
            return
        }
    }

    genMsg(trigger_id: string, record_list: StatusRecord[], terminal_lines: string[]): string {
        let data_array = record_list.map(item => {
            let templateArgs: Partial<Colorify<StatusRecord>> = {};
            // new_cert_id
            if (item["new_cert_id"] === null)
                templateArgs["new_cert_id"] = {
                    color: "error",
                    text: "获取失败"
                }
            else templateArgs["new_cert_id"] = {
                color: "gray",
                text: item["new_cert_id"]
            }

            // old_cert_id
            templateArgs["old_cert_id"] = {
                color: "gray",
                text: item["old_cert_id"]
            }

            // domain
            templateArgs["domain"] = {
                color: "gray",
                text: item["domain"]
            }

            // sans
            if (!Array.isArray(item["sans"]))
                templateArgs["sans"] = {
                    color: "error",
                    text: "获取失败"
                }
            else if (item["sans"].length === 0)
                templateArgs["sans"] = {
                    color: "light",
                    text: "无"
                }
            else templateArgs["sans"] = {
                color: "gray",
                text: item["sans"].join(", ")
            }

            // uploaded
            if (item["uploaded"] === null)
                templateArgs["uploaded"] = {
                    color: "warn",
                    text: "未进行"
                }
            else if (item["uploaded"] === false)
                templateArgs["uploaded"] = {
                    color: "error",
                    text: "上传失败"
                }
            else templateArgs["uploaded"] = {
                color: "success",
                text: "上传成功"
            }

            // updated
            if (item["updated"] === null)
                templateArgs["updated"] = {
                    color: "warn",
                    text: "未进行"
                }
            else if (item["updated"] === false)
                templateArgs["updated"] = {
                    color: "error",
                    text: "部署失败"
                }
            else templateArgs["updated"] = {
                color: "success",
                text: "部署成功"
            }

            // old_deleted
            if (item["old_deleted"] === null)
                templateArgs["old_deleted"] = {
                    color: "warn",
                    text: "未删除"
                }
            else if (item["old_deleted"] === false)
                templateArgs["old_deleted"] = {
                    color: "error",
                    text: "删除失败"
                }
            else templateArgs["old_deleted"] = {
                color: "success",
                text: "删除成功"
            }

            // comment
            if (item["comment"] === "")
                templateArgs["comment"] = {
                    color: "light",
                    text: "无"
                }
            else templateArgs["comment"] = {
                color: "gray",
                text: item["comment"]
            }

            return item;
        })

        // terminal_output
        let terminal_html = ansi2html(terminal_lines.join("\n"));

        let renderArgs = {
            trigger_id: trigger_id,
            data: data_array,
            output: terminal_html
        }

        if (this.mailer instanceof MailSender)
            return this.mailer.Template.HTML.render(renderArgs)
        else return ""
    }
}