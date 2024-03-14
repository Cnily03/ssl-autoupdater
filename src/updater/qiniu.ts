import fs from "fs"
import path from "path"
import Timer from "@/utils/timer"
import { sha256, ansi2html, hmacSha1 } from "@/utils/utils"
import MailSender from "@/utils/mail-sender"
import SSLUpdater, { SSLUpdaterOptions, CertificateData, sendMsgStatus, TriggerReturnTyoe } from "@/components/ssl-updater"
import urllib from "urllib"
import "colors"

type RequestMethod = "GET" | "POST" | "DELETE" | "PUT";

type StatusRecord = {
    new_cert_id: string | null,
    old_cert_id: string,
    domain: string,
    sans: string[],
    uploaded: boolean | null,
    cdn_updated: boolean | "part" | null,
    old_deleted: boolean | null,
    comment: string
}

type Colorify<T> = {
    [k in keyof T]: {
        color: string;
        text: string;
    }
}

namespace RequestHeader {
    export type ContentType = "application/json" | "application/x-www-form-urlencoded";
}

export namespace QiniuAPI {

    export interface ManualInjectedResponse {
        /**
         * HTTP 状态码（程序植入）
         */
        http_status: number
    }

    export interface APIBaseResponse extends ManualInjectedResponse {
        /**
         * 前三位与 HTTP 状态码一致，或为 0
         */
        code?: number
        /**
         * 错误信息
         */
        error?: string
    }

    export interface Certificates {
        /**
         * 证书 ID
         */
        certid: string
        /**
         * 证书名称
         */
        name: string
        /**
         * 用户 ID
         */
        uid: number
        /**
         * 域名（通用名称）
         */
        common_name: string
        /**
         * 域名 SANs
         */
        dnsnames: string[]
        /**
         * 证书创建时间
         */
        create_time: number
        /**
         * 证书生效时间（单位：秒）
         */
        not_before: number
        /**
         * 证书过期时间（单位：秒）
         */
        not_after: number
        /**
         * 订单号
         */
        orderid: string
        /**
         * 产品名称
         */
        product_short_name: string
        /**
         * 产品类型
         */
        product_type: string
        /**
         * 证书类型
         */
        cert_type: string
        /**
         * 加密方式
         */
        encrypt: string
        /**
         * 加密参数
         */
        encryptParameter: string
        /**
         * 启用状态
         */
        enable: boolean
        /**
         * 子订单号
         */
        child_order_id: string
        /**
         * 状态
         */
        state: string
        /**
         * 自动更新
         */
        auto_renew: boolean
        /**
         * 可更新
         */
        renewable: boolean
    }

    export interface Certificate {
        /**
         * 证书 ID
         */
        certid: string
        /**
         * 证书名称
         */
        name: string
        /**
         * 用户 ID
         */
        uid: number
        /**
         * 域名（通用名称）
         */
        common_name: string
        /**
         * 域名 SANs
         */
        dnsnames: string[]
        /**
         * 证书创建时间
         */
        create_time: number
        /**
         * 证书生效时间（单位：秒）
         */
        not_before: number
        /**
         * 证书过期时间（单位：秒）
         */
        not_after: number
        /**
         * 订单号
         */
        orderid: string
        /**
         * 产品名称
         */
        product_short_name: string
        /**
         * 产品类型
         */
        product_type: string
        /**
         * 证书类型
         */
        cert_type: string
        /**
         * 加密方式
         */
        encrypt: string
        /**
         * 加密参数
         */
        encryptParameter: string
        /**
         * 启用状态
         */
        enable: boolean
        /**
         * 子订单号
         */
        child_order_id: string
        /**
         * 状态
         */
        state: string
        /**
         * 自动更新
         */
        auto_renew: boolean
        /**
         * 可更新
         */
        renewable: boolean
        /**
         * 证书内容
         */
        ca: string
        /**
         * 私钥内容
         */
        pri: string
    }

    export interface CdnDomains {
        /**
         * 域名
         */
        name: string
        /**
         * 域名类型
         */
        type: string
        /**
         * CNAME（七牛云的域名）
         */
        cname: string
        /**
         * 域名的测试资源，需要保证这个资源是可访问的
         */
        testURLPath: string
        /**
         * 平台
         */
        platform: string
        /**
         * 覆盖范围
         */
        geoCover: string
        /**
         * 协议
         */
        protocol: string
        /**
         * 域名最近一次的操作状态
         */
        operatingState: "processing" | "success" | "failed" | "frozen" | "offlined"
        /**
         * 域名最近一次的操作状态描述
         */
        operatingStateDesc: string
        /**
         * 域名创建时间（格式：RFC3339）
         */
        createAt: string
        /**
         * 域名最后一次的修改时间（格式：RFC3339）
         */
        modifyAt: string
        // ... 还有好多不想写了 // TODO: 补全
    }

    export interface CdnSource {
        /**
         * 回源类型
         */
        sourceType: "domain" | "ip" | "qiniuBucket" | "advanced"
        /**
         * 回源 Host
         */
        sourceHost: string
        /**
         * 回源 IP 列表
         */
        sourceIPs: string[]
        /**
         * 回源域名
         */
        sourceDomain: string
        /**
         * 回源的七牛云存储的bucket名称
         */
        sourceQiniuBucket: string
        /**
         * 回源协议, 仅用于 https 域名, 回源七牛 bucket 时本值无效，默认不填是跟随请求协议
         */
        sourceURLScheme: "http" | "https"
        advancedSources: {
            /**
             * 高级回源的回源地址, 可以是 IP 或者域名； 如需指定端口，可直接拼接在地址后面（示例: `1.1.1.1:8080`）
             */
            addr: string
            /**
             * 高级回源的回源 addr 权重, `0` ~ `100`, 按照权重比例回源
             */
            weight: number
            /**
             * 高级回源的回源 addr 是否为备源地址
             */
            backup: boolean
        }[]
        /**
         * 用于测试的 URL Path, 检测源站是否可访问, 大小建议小于 1KB，采用静态资源，并请不要删除, 后面域名任何配置更改都会测试该资源, 用以保证域名的访问性
         */
        testURLPath: string
    }

    export interface CdnCache {
        cacheControls: {
            /**
             * 缓存时间（注意不论哪种时间单位，总时间都不能超过 1 年）
             */
            time: number
            /**
             * 缓存时间单位（若`type`为`follow`，此字段配为`0`，表示遵循源站）
             * - 0: 秒
             * - 1: 分钟
             * - 2: 小时
             * - 3: 天
             * - 4: 周
             * - 5: 月
             * - 6: 年
             */
            timeunit: 0 | 1 | 2 | 3 | 4 | 5 | 6
            /**
             * 缓存类型 \
             * all: 默认全局规则 \
             * path: 路径匹配 \
             * suffix: 后缀匹配 \
             * follow: 遵循源站
             */
            type: "all" | "path" | "suffix" | "follow"
            /**
             * 缓存路径规则：以分号`;`分割的字符串，每个里面类型一致，比如`type`为`path`的话，这里每个分号分割的都是以`/`开头，`suffix`的话，以点号`.`开头，如果是`all`或者`follow`类型，统一只要填一个星号`*`
             */
            rule: string
        }[]
        /**
         * 是否开启去问号缓存（忽略参数），默认为`false`
         */
        ignoreParam: boolean
    }

    export interface CdnReferer {
        /**
         * Referer 防盗链类型
         */
        refererType: "black" | "white"
        /**
         * 	Referer 防盗链黑白名单
         */
        refererValues: string[]
        /**
         * 是否支持空 referer
         */
        nullReferer: boolean
    }

    export interface CdnIPACL {
        /**
         * IP 黑白名单类型
         */
        ipACLType: "black" | "white"
        /**
         * IP 黑白名单
         */
        ipACLValues: string[]
    }

    export interface CdnTimeACL {
        /**
         * 开启时间戳防盗链的开关
         */
        enable: boolean
        /**
         * 时间戳防盗链的加密 key，该 key 字符长区间为 [24,40]，`enable`为`true`时必填 2 个key，`enable`为`false`时不填
         */
        timeACLKeys: string[]
        /**
         * 根据时间戳防盗链加密算法生成的 URL，`enable`为`true`时本项必填, 用以验证是否真实了解该时间戳防盗链加密算法
         */
        checkUrl: string
    }

    export interface CdnBsauth {
        // {
        //     "isQiniuPrivate": <IsQiniuPrivate>
        //     "path": [<Path>, ...]
        //     "method": <Method>
        //     "parameters": [<Parameter>, ...]
        //     "timeLimit": <TimeLimit>
        //     "userAuthUrl": <UserAuthUrl>
        //     "strict": <Strict>
        //     "enable": <Enable>
        //     "successStatusCode": <SuccessStatusCode>
        //     "failureStatusCode": <FailureStatusCode>
        // }
        /**
         * 是否为七牛私有bucket鉴权，如果是七牛私有bucket，只需要打开 enable开关，本功能将随着回源鉴权功能使用
         */
        isQiniuPrivate: boolean
        /**
         * 要匹配这个回源鉴权的 path，如果使用七牛私有bucket鉴权，不需要填
         */
        path: string[]
        /**
         * 回源鉴权的方法，如果使用七牛私有bucket鉴权，不需要填
         */
        method: "GET" | "POST" | "HEAD"
        /**
         * 回源鉴权中参与鉴权的 URL 参数，取值取决于用户鉴权服务器的鉴权规则，如果使用七牛私有bucket鉴权，不需要填
         */
        parameters: string[]
        /**
         * 回源鉴权的鉴权超时时间，单位`ms`（最小`100ms`, 最大`10000ms`），如果使用七牛私有bucket鉴权，不需要填
         */
        timeLimit: number
        /**
         * 用户鉴权服务器地址，如果使用七牛私有bucket鉴权，不需要填
         */
        userAuthUrl: string
        /**
         * 是否严格模式（超时后，是否严格为鉴权失败），如果使用七牛私有bucket鉴权，不需要填
         */
        strict: boolean
        /**
         * 是否开启回源鉴权
         */
        enable: boolean
        /**
         * 鉴权成功的 HTTP 状态码（最小`100`，最大`10000`），如果使用七牛私有bucket鉴权，不需要填
         */
        successStatusCode: number
        /**
         * 鉴权失败的 HTTP 状态码（最小`100`，最大`10000`），如果使用七牛私有bucket鉴权，不需要填
         */
        failureStatusCode: number
    }

    export interface CdnHttpsConf {
        /**
         * 证书 ID
         */
        certId: string
        /**
         * 是否强制开启 HTTPS
         */
        forceHttps: boolean
        /**
         * 是否开启 HTTP2
         */
        http2Enable: boolean
    }

    export interface CertListResponse extends APIBaseResponse {
        certs: Certificates[]
        /**
         * 用于标示下一次从哪个位置开始获取证书列表
         */
        marker: string
    }

    export interface CertDetailResponse extends APIBaseResponse {
        cert: Certificate
    }

    export interface CertDeleteResponse extends APIBaseResponse {
    }

    export interface CertUploadRequest {
        /**
         * 证书名称
         */
        name: string
        /**
         * 域名（通用名称）
         */
        common_name: string
        /**
         * 证书内容
         */
        ca: string
        /**
         * 私钥内容
         */
        pri: string
    }

    export interface CertUploadResponse extends APIBaseResponse {
        /**
         * 证书 ID
         */
        certID: string
    }

    export interface CdnDomainListResponse extends APIBaseResponse {
        domains: CdnDomains[]
        /**
         * 用于标示下一次从哪个位置开始获取域名列表
         */
        marker: string
    }

    export interface CdnDomainDetailResponse extends APIBaseResponse {
        /**
         * 域名
         */
        name: string
        /**
         * 域名类型
         */
        type: string
        /**
         * CNAME（七牛云的域名）
         */
        cname: string
        /**
         * 域名的测试资源，需要保证这个资源是可访问的
         */
        testURLPath: string
        /**
         * 平台
         */
        platform: string
        /**
         * 覆盖范围
         */
        geoCover: string
        /**
         * 协议
         */
        protocol: string
        /**
         * IP协议（仅允许 ipv4 访问，取值为 `1`；同时允许 ipv4/ipv6 访问，取值为 `3`）
         */
        ipTypes: number
        /**
         * 标签列表
         */
        tagList: string[]
        /**
         * 回源配置
         */
        source: CdnSource
        /**
         * 缓存策略
         */
        cache: CdnCache
        /**
         * Referer 防盗链
         */
        referer: CdnReferer
        /**
         * IP 黑白名单
         */
        ipACL: CdnIPACL
        /**
         * 时间戳防盗链
         */
        timeACL: CdnTimeACL
        /**
         * 回源鉴权
         */
        bsauth: CdnBsauth
        /**
         * HTTPS 配置
         */
        https: CdnHttpsConf
        /**
         * 域名最近一次操作类型
         * - `modify_timeacl` (修改时间戳防盗链)
         * - `sslize` (升级HTTPS)
         * - `modify_bsauth` (修改回源鉴权)
         * - `offline_bsauth` (删除回源鉴权)
         * - ...
         */
        operationType: "create_domain" | "offline_domain" | "online_domain" | "modify_source" | "modify_referer" | "modify_cache" | "freeze_domain" | "unfreeze_domain" | "modify_timeacl" | "modify_https_crt" | "sslize" | "modify_bsauth" | "offline_bsauth"
        /**
         * 域名最近一次的操作状态
         */
        operatingState: "processing" | "success" | "failed" | "frozen" | "offlined"
        /**
         * 域名最近一次的操作状态描述
         */
        operatingStateDesc: string
        /**
         * 域名创建时间（格式：RFC3339）
         */
        createAt: string
        /**
         * 域名最后一次的修改时间（格式：RFC3339）
         */
        modifyAt: string
        /**
         * 父域名，属于泛域名字段
         */
        pareDomain: string
    }

    export interface CdnDomainModifyCertRequest {
        /**
         * 证书 ID
         */
        certid: string
        /**
         * 是否强制开启 HTTPS
         */
        forceHttps: boolean
        /**
         * 是否开启 HTTP2
         */
        http2Enable: boolean
    }

    export interface CdnDomainModifyHttpsConf extends APIBaseResponse {
    }
}

export class QiniuSSLUpdater extends SSLUpdater {
    private generateAccessToken: (uri: string, reqBody?: string) => string;

    /**
     * 七牛云证书更新器
     * @param accessKey 七牛云 AK
     * @param secretKey 七牛云 SK
     */
    constructor(accessKey: string, secretKey: string, opts: SSLUpdaterOptions = {}) {
        super("Qiniu", opts);

        // mailer
        if (this.mailer instanceof MailSender) {
            this.mailer.Template.HTML.set(fs.readFileSync(path.resolve(__dirname, "../template/qiniu.ejs"), "utf-8"));
        }

        // access token
        this.generateAccessToken = (uri, reqBody = '') => {
            let u = new URL(uri);
            let access = u.pathname + u.search + "\n";
            if (reqBody) access += reqBody;
            const base64_to_safe = (v: string) => v.replace(/\//g, '_').replace(/\+/g, '-');
            let digest = hmacSha1(access, secretKey);
            return accessKey + ":" + base64_to_safe(digest);
        }
    }

    /**
     * 发送 API 请求
     */
    async request(method: RequestMethod, path: string, contentType: RequestHeader.ContentType, body: string = '') {
        const uri = "https://api.qiniu.com" + path;
        let tokenBody = contentType === "application/x-www-form-urlencoded" ? body : '';
        let accessToken = this.generateAccessToken(uri, tokenBody);
        return await urllib.request(uri, {
            method: method,
            headers: {
                "content-type": contentType,
                "Authorization": "QBox " + accessToken,
            },
            content: body
        }).then(r => {
            const res = JSON.parse(r.data.toString())
            res.http_status = r.status;
            return res;
        }).catch(err => { throw err });
    }

    private is_success_code(code?: number, http_status?: number) {
        if (typeof code === "undefined") return http_status === 200;
        else if (code === 0) return true;
        else if (code.toString().startsWith("200")) return true;
        else return false;
    }

    /**
     * 获取证书列表
     */
    async getCertList() {
        let certList = await this.request("GET", "/sslcert", "application/x-www-form-urlencoded");
        return certList as Promise<QiniuAPI.CertListResponse>;
    }

    /**
     * 获取证书信息
     */
    async getCertDetail(cert_id: string) {
        let certInfo = await this.request("GET", `/sslcert/${cert_id}`, "application/x-www-form-urlencoded");
        return certInfo as Promise<QiniuAPI.CertDetailResponse>;
    }

    /**
     * 删除证书
     */
    async deleteCert(cert_id: string) {
        let deleteResp = await this.request("DELETE", `/sslcert/${cert_id}`, "application/x-www-form-urlencoded");
        return deleteResp as Promise<QiniuAPI.CertDeleteResponse>;
    }

    /**
     * 上传证书
     */
    async uploadCert(name: string, domain: string, others: CertificateData) {
        let uploadResp = await this.request("POST", "/sslcert", "application/json", JSON.stringify({
            name: name,
            common_name: domain,
            ca: others.public,
            pri: others.private
        }));
        return uploadResp as Promise<QiniuAPI.CertUploadResponse>;
    }

    /**
     * 获取 CDN 域名列表
     * @param certid 证书 ID
     */
    async getCdnDomainList(certid?: string) {
        let path = "/domain";
        if (typeof certid === "string") path += `?certid=${certid}`;

        let domainList = await this.request("GET", path, "application/x-www-form-urlencoded");
        return domainList as Promise<QiniuAPI.CdnDomainListResponse>;
    }

    /**
     * 获取 CDN 域名详情
     * @param domain 域名
     */
    async getCdnDomainDetail(domain: string) {
        let domainDetail = await this.request("GET", `/domain/${domain}`, "application/x-www-form-urlencoded");
        return domainDetail as Promise<QiniuAPI.CdnDomainDetailResponse>;
    }

    /**
     * 修改 CDN 域名 HTTPS 配置
     */
    async modifyCdnHttpsConf(domain: string, others: QiniuAPI.CdnDomainModifyCertRequest) {
        let modifyResp = await this.request("PUT", `/domain/${domain}/httpsconf`, "application/json", JSON.stringify({
            certid: others.certid,
            forceHttps: others.forceHttps,
            http2Enable: others.http2Enable
        }));
        return modifyResp as Promise<QiniuAPI.CdnDomainModifyHttpsConf>;
    }

    /**
     * 等待 CDN 域名更新完成
     */
    async _waitUntilNoCdnDomain(certid: string) {
        const TTL = 15 * 60 * 1000;
        const DDL = Timer.now() + TTL;
        return await new Promise((resolve, reject) => {
            let itvid = setInterval(async () => {
                let domain_list_resp = await this.getCdnDomainList(certid);
                if (domain_list_resp.domains.length === 0) {
                    clearInterval(itvid);
                    return resolve(true);
                }
                if (Timer.now() > DDL) {
                    clearInterval(itvid);
                    return resolve(false);
                }
            }, 1 * 60 * 1000)
        })
    }

    async triggerUpdate(domains: string[]): Promise<TriggerReturnTyoe<StatusRecord[]>> {
        let status_record_json: { [cert_id: string]: StatusRecord } = {};
        let do_send_mail = false
        const fmt = (c?: number) => typeof c === "undefined" ? "?" : c.toString();
        try {
            const detectAll = typeof domains === "undefined" || domains.length === 0;
            this.output.log("OPTION", "DETECT_ALL", detectAll ? "ON" : "OFF");

            // get cert list
            this.output.log("STEP", "GET_CERT_LIST", "START");
            let list_resp = await this.getCertList();
            if (!this.is_success_code(list_resp.code, list_resp.http_status)) {
                this.output.log("STEP", "GET_CERT_LIST", "FAILED".red, "|", "CODE", fmt(list_resp.code));
                this.output.failure(`Failed to get certificate list`);
                throw new Error(list_resp.error);
            }
            this.output.log("STEP", "GET_CERT_LIST", "DONE", "|", "CODE", fmt(list_resp.code));

            let cert_list = detectAll ? list_resp.certs : list_resp.certs.filter(c => domains.includes(c.common_name));
            this.output.log("DATA", "CERT_LIST", "|", "COUNT[TOTAL]", fmt(list_resp.certs.length), "|", "COUNT[FILTERED]", fmt(cert_list.length));

            let need_update_certificates = []; // { cert_info, upload_resp }

            for (let cert_info of cert_list) {
                this.output.log("STEP", "UPLOAD", "START",
                    "|", "OLD_CERT_ID", cert_info.certid,
                    "|", "DOMAIN", cert_info.common_name,
                    "|", "ALIAS", cert_info.name);

                let is_force_upload = this._force_upload_days > 0 && (new Date(cert_info.not_after * 1000).getTime() - Timer.now() < this._force_upload_days * 24 * 60 * 60 * 1000)

                const { public: local_pubcer, private: local_ptekey } = this._founder(cert_info.common_name, cert_info.dnsnames, cert_info.encrypt);
                if (typeof local_pubcer !== "string" || typeof local_ptekey !== "string") {
                    // file not found
                    this.output.log("FILE", "LOCAL_CERT_BOTH", "NOT_FOUND".yellow);
                    this.output.warn(`No certificate file found for domain ${cert_info.common_name}, skip`);
                    this.output.log("STEP", "UPLOAD", "SKIP", "|", "REASON", "LOCAL_CERT_NOT_FOUND");
                    continue;
                }

                const local_pubcer_sha256 = sha256(SSLUpdater.formatCert(local_pubcer));
                const local_ptekey_sha256 = sha256(SSLUpdater.formatCert(local_ptekey));

                let is_local_changed = this.cache.is_changed([cert_info.common_name, cert_info.dnsnames, cert_info.encrypt], {
                    public: local_pubcer_sha256,
                    private: local_ptekey_sha256
                }, true)

                let need_upload = is_force_upload || is_local_changed

                if (!need_upload && !is_local_changed) {
                    this.output.log("STEP", "UPLOAD", "SKIP", "|", "REASON", "LOCAL_CERT_NO_CHANGE");
                    this.output.info(`Local certificate for domain ${cert_info.common_name} has no change, no need to update`);
                    continue;
                }

                this.output.log("PROCESS", "FORCE_UPLOAD", is_force_upload ? "ON" : "OFF")

                // get detail
                this.output.log("STEP", "UPLOAD[GET_OLD_DETAIL]", "START", "|", "OLD_CERT_ID", cert_info.certid)
                let detail_resp = await this.getCertDetail(cert_info.certid);
                this.output.log("STEP", "UPLOAD[GET_OLD_DETAIL]", "DONE", "|", "CODE", fmt(detail_resp.code));
                if (detail_resp.cert.orderid !== '') {
                    // not uploaded by user, skip
                    this.output.log("STEP", "UPLOAD", "SKIP", "|", "REASON", "NOT_USER_UPLOADED");
                    this.output.info(`Certificate ${cert_info.certid} for domain ${cert_info.common_name} is not uploaded by user, skip`);
                    continue;
                }

                const remote_pubcer_sha256 = sha256(SSLUpdater.formatCert(detail_resp.cert.ca));
                const remote_ptekey_sha256 = sha256(SSLUpdater.formatCert(detail_resp.cert.pri));

                let is_remote_different = remote_pubcer_sha256 !== local_pubcer_sha256 || remote_ptekey_sha256 !== local_ptekey_sha256;

                if (!is_remote_different) {
                    // cert content no change
                    this.output.log("STEP", "UPLOAD", "SKIP", "|", "REASON", "REMOTE_SAME_AS_LOCAL");
                    this.output.info(`Domain ${cert_info.common_name} with certificate ${cert_info.certid} has no change, skip`);
                    continue;
                }

                // [+] start recording
                this.output.log("PROCESS", "START_RECORD");
                status_record_json[cert_info.certid] = {
                    new_cert_id: null, // null 表示未进行
                    old_cert_id: cert_info.certid,
                    domain: cert_info.common_name,
                    sans: cert_info.dnsnames || [],
                    uploaded: null, // null 表示未进行, false 表示失败, true 表示成功
                    cdn_updated: null,
                    old_deleted: null,
                    comment: ''
                }
                do_send_mail = true

                // upload
                this.output.log("STEP", "UPLOAD[UPLOAD_NEW_CERT]", "START");
                this.output.info(`Uploading certificate for domain ${cert_info.common_name}...`);
                status_record_json[cert_info.certid].uploaded = false;
                let upload_resp = await this.uploadCert(cert_info.name, cert_info.common_name, {
                    public: local_pubcer,
                    private: local_ptekey
                });
                if (!this.is_success_code(upload_resp.code, upload_resp.http_status)) {
                    this.output.log("STEP", "UPLOAD[UPLOAD_NEW_CERT]", "FAILED".red, "|", "CODE", fmt(upload_resp.code));
                    this.output.failure(`Failed to upload certificate for domain ${cert_info.common_name}`);
                    if (upload_resp.error) this.output.error(upload_resp.error);
                    this.output.log("STEP", "UPLOAD", "FAILED".red);
                    continue;
                }
                status_record_json[cert_info.certid].uploaded = true;
                status_record_json[cert_info.certid].new_cert_id = upload_resp.certID;
                this.output.log("STEP", "UPLOAD[UPLOAD_NEW_CERT]", "DONE",
                    "|", "CODE", fmt(upload_resp.code),
                    "|", "NEW_CERT_ID", upload_resp.certID);

                // upload complete
                this.output.log("PROCESS", "CACHE")
                this.cache.set([cert_info.common_name, cert_info.dnsnames, cert_info.encrypt], {
                    public: local_pubcer_sha256,
                    private: local_ptekey_sha256
                })

                need_update_certificates.push({ cert_info, upload_resp });
                this.output.log("STEP", "UPLOAD", "DONE");
                this.output.success(`Successfully uploaded new certificate ${upload_resp.certID} for domain ${cert_info.common_name} (${cert_info.name})`);
            }

            this.output.log("DATA", "NEED_UPDATE_CERTIFICATES", "|", "COUNT", fmt(need_update_certificates.length));

            let delete_promise_pool = [];

            for (let { cert_info, upload_resp } of need_update_certificates) {
                this.output.log("STEP", "UPDATE", "START",
                    "|", "NEW_CERT_ID", upload_resp.certID,
                    "|", "OLD_CERT_ID", cert_info.certid,
                    "|", "DOMAIN", cert_info.common_name,
                    "|", "ALIAS", cert_info.name);
                this.output.info(`Updating related CDN domains (apply new certificate ${upload_resp.certID})...`);

                // find bound cdn domains
                this.output.log("STEP", "UPDATE[GET_CDN_DOMAIN_LIST]", "START");
                let domain_list_resp = await this.getCdnDomainList(cert_info.certid);
                if (!this.is_success_code(domain_list_resp.code, domain_list_resp.http_status)) {
                    this.output.log("STEP", "UPDATE[GET_CDN_DOMAIN_LIST]", "FAILED".red, "|", "CODE", fmt(domain_list_resp.code));
                    this.output.failure(`Failed to get CDN domain list for certificate ${cert_info.certid} (${cert_info.name})`);
                    if (domain_list_resp.error) this.output.error(domain_list_resp.error);
                    this.output.log("STEP", "UPDATE", "FAILED".red);
                    continue;
                }
                this.output.log("STEP", "UPDATE[GET_CDN_DOMAIN_LIST]", "DONE", "|", "CODE", fmt(domain_list_resp.code));

                let domain_list = domain_list_resp.domains.map(d => d.name);
                this.output.log("DATA", "CDN_DOMAIN_LIST", "|", "COUNT", fmt(domain_list.length));

                // update cdn cert
                status_record_json[cert_info.certid].cdn_updated = false;
                let success_count = 0;
                if (domain_list.length === 0) status_record_json[cert_info.certid].comment = "该证书无绑定的 CDN 资源";
                for (let one_domain of domain_list) {
                    this.output.log("STEP", "UPDATE_CDN", "START", "|", "CDN_DOMAIN", one_domain);
                    // get former https config
                    this.output.log("STEP", "UPDATE_CDN[GET_OLD_HTTPS_CONF]", "START");
                    let domain_detail_resp = await this.getCdnDomainDetail(one_domain);
                    if (!this.is_success_code(domain_detail_resp.code, domain_detail_resp.http_status)) {
                        this.output.log("STEP", "UPDATE_CDN[GET_OLD_HTTPS_CONF]", "FAILED".red, "|", "CODE", fmt(domain_detail_resp.code));
                        this.output.failure(`Failed to get CDN domain detail for CDN domain ${one_domain}`);
                        if (domain_detail_resp.error) this.output.error(domain_detail_resp.error);
                        this.output.log("STEP", "UPDATE_CDN", "FAILED".red);
                        continue;
                    }
                    this.output.log("STEP", "UPDATE_CDN[GET_OLD_HTTPS_CONF]", "DONE", "|", "CODE", fmt(domain_detail_resp.code));

                    // update https config (update cert id)
                    this.output.log("STEP", "UPDATE_CDN[MODIFY_NEW]", "START", "|", "NEW_CERT_ID", upload_resp.certID);
                    let modify_https_resp = await this.modifyCdnHttpsConf(one_domain, {
                        certid: upload_resp.certID,
                        forceHttps: domain_detail_resp.https.forceHttps,
                        http2Enable: domain_detail_resp.https.http2Enable
                    });
                    if (!this.is_success_code(modify_https_resp.code, modify_https_resp.http_status)) {
                        this.output.log("STEP", "UPDATE_CDN[MODIFY_NEW]", "FAILED".red, "|", "CODE", fmt(modify_https_resp.code));
                        this.output.failure(`Failed to modify HTTPS configuration for CDN domain ${one_domain}`);
                        if (modify_https_resp.error) this.output.error(modify_https_resp.error);
                        this.output.log("STEP", "UPDATE_CDN", "FAILED".red);
                        continue;
                    }
                    ++success_count;
                    this.output.log("STEP", "UPDATE_CDN[MODIFY_NEW]", "DONE", "|", "CODE", fmt(modify_https_resp.code));
                }
                if (success_count !== domain_list.length) {
                    status_record_json[cert_info.certid].cdn_updated = "part"
                    this.output.warn(`Part of CDN domains failed to update (apply certificate ${upload_resp.certID}), please check manually`);
                } else {
                    status_record_json[cert_info.certid].cdn_updated = true;
                    this.output.success(`Successfully send update task for all related CDN domains (apply certificate ${upload_resp.certID})`);
                }
                this.output.log("STEP", "UPDATE_CDN", "DONE", "|", "COUNT[TOTAL]", fmt(domain_list.length), "|", "COUNT[SUCCESS]", fmt(success_count));

                // delete old cert
                this.output.log("STEP", "DELETE_OLD_CERT", "START",
                    "|", "OLD_CERT_ID", cert_info.certid,
                    "|", "DOMAIN", cert_info.common_name,
                    "|", "ALIAS", cert_info.name);

                if (success_count !== domain_list.length) {
                    this.output.log("STEP", "DELETE_OLD_CERT", "SKIP", "|", "REASON", "UPDATE_CDN_NOT_COMPLETE");
                    this.output.info(`Part of CDN domains failed to update, skip deleting old certificate ${cert_info.certid}`)
                    continue;
                }

                const p = new Promise(async (resolve, reject) => {

                    this.output.log("PROCESS", "WAIT_UNTIL_CDN_UPDATE_COMPLETE", "|", "OLD_CERT_ID", cert_info.certid);
                    this.output.info(`Pending for CDN update complete (certificate ${cert_info.certid})...`)
                    const intime = await this._waitUntilNoCdnDomain(cert_info.certid)
                    this.output.info(`Pending done (certificate ${cert_info.certid}). Start deleting...`)

                    status_record_json[cert_info.certid].old_deleted = false;
                    let delete_resp = await this.deleteCert(cert_info.certid);

                    if (!this.is_success_code(delete_resp.code, delete_resp.http_status)) {
                        this.output.log("STEP", "DELETE_OLD_CERT", "FAILED".red,
                            "|", "CODE", fmt(delete_resp.code),
                            "|", "OLD_CERT_ID", cert_info.certid,
                            "|", "DOMAIN", cert_info.common_name,
                            "|", "ALIAS", cert_info.name);
                        this.output.failure(`Failed to delete old certificate ${cert_info.certid}`);
                        if (delete_resp.error) this.output.error(delete_resp.error);
                        return resolve(false);
                    }

                    status_record_json[cert_info.certid].old_deleted = true;
                    this.output.log("STEP", "DELETE_OLD_CERT", "DONE",
                        "|", "CODE", fmt(delete_resp.code),
                        "|", "OLD_CERT_ID", cert_info.certid,
                        "|", "DOMAIN", cert_info.common_name,
                        "|", "ALIAS", cert_info.name);

                    this.output.success(`Certificate ${cert_info.certid} for domain ${cert_info.common_name} has been deleted`);
                    return resolve(true);
                })
                delete_promise_pool.push(p);
            }
            await Promise.all(delete_promise_pool);
        } catch (err) { this.output.error(err); }
        return {
            msg_material: Object.values(status_record_json),
            send_mail: do_send_mail
        }
    }

    async sendMsg(title: string, content: string): Promise<sendMsgStatus> {
        if (!content) return "cancel";
        if (this.mailer) {
            let status = await this.mailer.send(title, "html", content).then(() => true)
                .catch(err => { this.output.error(err); return false })
            return status ? "success" : "failure";
        } else {
            return "cancel"
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
                    text: "未知错误"
                }
            else if (item["sans"].length === 0)
                templateArgs["sans"] = {
                    color: "light",
                    text: "无"
                }
            else templateArgs["sans"] = {
                color: "gray",
                text: item["sans"].filter((v: string) => v !== item["domain"]).join(", ")
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
            if (item["cdn_updated"] === null)
                templateArgs["cdn_updated"] = {
                    color: "warn",
                    text: "未进行"
                }
            else if (item["cdn_updated"] === false)
                templateArgs["cdn_updated"] = {
                    color: "error",
                    text: "更新失败"
                }
            else if (item["cdn_updated"] === "part")
                templateArgs["cdn_updated"] = {
                    color: "warn",
                    text: "部分成功"
                }
            else templateArgs["cdn_updated"] = {
                color: "success",
                text: "更新成功"
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

            return templateArgs;
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