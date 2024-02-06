import MailSender from "@/utils/mail-sender"
import Timer from "@/utils/timer"
import Cache from "@/utils/cache"
import { Session } from "@/components/session"
import { Output } from "@/components/output"
import fs from "fs"
import path from "path"
import { sha256 } from "@/utils/utils"

export type CertificateData = {
    public: string,
    private: string
}

/**
 * 根据域名和算法获取证书内容的函数，返回证书内容和私钥内容 \
 * 如果文件不存在，则该文件内容返回 `undefined`
 */
type FounderFunc = (domain: string, sans: string[], algorithm?: string) => Partial<CertificateData>
type AvailableFounder = "acme.sh"

export type sendMsgStatus = "success" | "failure" | "cancel"

export type SSLUpdaterOptions = {
    /**
     * 根据域名和算法获取证书内容的函数，返回证书内容和私钥内容 \
     * 如果文件不存在，返回空的 JSON 对象 `{}` \
     * 如果是 acme.sh 生成的证书，可以直接填入 `"acme.sh"`
     * @default "acme.sh"
     */
    founder?: AvailableFounder | FounderFunc,
    /**
     * 距离证书到期的时间小于该天数时，强制上传证书（输入`0`禁用）
     * @default 0
     */
    force_upload_days?: number,
    /**
     * 定时任务开始时间
     * @default `当天的 04:00:00`
     */
    timer_start?: number | string | Date,
    /**
     * 每隔多少毫秒进行一次检测
     * @default 24 * 60 * 60 * 1000
     */
    timer_interval?: number,
    /**
     * 邮件发送器（默认不发送邮件）
     */
    mailer?: MailSender
}

export type StatusRecord = {
    new_cert_id: string,
    old_cert_id: string,
    domain: string,
    sans: string[],
    uploaded: boolean | null,
    updated: boolean | null,
    old_deleted: boolean | null,
    comment: string
}

function genTimeBasedHash(identifier: string, random_upper: boolean = false) {
    let raw = `[${identifier}]` + Timer.now().toString() + "+" + Math.random().toString();
    let hash = sha256(raw).slice(0, 32)
    if (random_upper)
        hash = hash
            .split("")
            .map(c => (Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase())).join("")
    return [
        hash.substring(0, 8),
        hash.substring(8, 12),
        hash.substring(12, 16),
        hash.substring(16, 20),
        hash.substring(20, 32)
    ].join("-");
}

function acmeshFounder(domain: string, sans: string[], algorithm = "RSA 4096"): Partial<CertificateData> {
    let home_path = process.env.HOME || process.env.USERPROFILE || "/root";
    let domain_dir = domain
    algorithm = algorithm.toLowerCase();
    if (algorithm.startsWith("ec")) {
        domain_dir += "_ecc";
    }

    let pub_path = path.join(home_path, ".acme.sh", domain_dir, "fullchain.cer");
    let pte_path = path.join(home_path, ".acme.sh", domain_dir, domain + ".key");
    return {
        public: fs.existsSync(pub_path) ? fs.readFileSync(pub_path, "utf-8") : undefined,
        private: fs.existsSync(pte_path) ? fs.readFileSync(pte_path, "utf-8") : undefined
    }
}

export default abstract class SSLUpdater {
    public identifier: string;
    protected _founder: FounderFunc;
    protected _force_upload_days: number;
    protected mailer: MailSender | null;
    protected timer: Timer;
    protected cache: Cache;
    protected watch_pool: Set<NodeJS.Timeout>;
    public session: Session;
    public output: Output;

    /**
     * 证书更新器
     */
    constructor(identifier: string, opts?: SSLUpdaterOptions) {
        this.identifier = identifier;

        if (typeof opts === "undefined") opts = {};

        // [+] option format
        // opts.founder
        let founderMap = {
            "acme.sh": acmeshFounder
        }
        let defaultFounderKey: keyof typeof founderMap = "acme.sh";
        if (typeof opts.founder === "undefined") this._founder = founderMap[defaultFounderKey];
        else if (typeof opts.founder === "function") this._founder = opts.founder;
        else if (typeof opts.founder === "string") {
            if (typeof founderMap[opts.founder] === "undefined") throw new Error(`Founder "${opts.founder}" is not available`);
            else this._founder = founderMap[opts.founder];
        } else throw new TypeError("Founder must be a function or string");

        // opts.force_upload_days
        let defaultForceUploadDays = 0;
        if (typeof opts.force_upload_days === "undefined") this._force_upload_days = defaultForceUploadDays;
        else if (typeof opts.force_upload_days === "number") {
            if (opts.force_upload_days < 0) this._force_upload_days = 0;
            else this._force_upload_days = opts.force_upload_days;
        } else throw new TypeError("force_upload_days must be a number");

        // opts.mailer
        if (typeof opts.mailer === "undefined") this.mailer = null;
        else if (opts.mailer instanceof MailSender) {
            this.mailer = opts.mailer;
        }
        else throw new TypeError("mailer must be an instance of MailSender");

        // timer
        let defaultTimerStart = new Date();
        defaultTimerStart.setHours(4, 0, 0, 0)
        let defaultTimerInterval = 24 * 60 * 60 * 1000;
        this.timer = new Timer(opts.timer_start || defaultTimerStart, opts.timer_interval || defaultTimerInterval);

        this.cache = new Cache();

        this.session = new Session()
        this.output = new Output(this.session, this.identifier);

        // ID of setInterval
        this.watch_pool = new Set();
    }

    /**
     * 将证书的格式统一化
     */
    static formatCert(content: string) {
        content = content.trim();
        content = content.replace(/\r\n/g, "\n");
        content = content.replace(/\n+/g, "\n");
        return content;
    }

    /**
     * 自动监测域名，并更新证书
     * @param domains 检测的域名列表（域名为主域名，不包括 SANS），为空则表示所有域名、不进行过滤
     */
    async watch(domains: string | string[] = []) {
        const that = this;
        // check parameter
        if (typeof domains === "undefined") domains = [];
        if (!Array.isArray(domains)) domains = [domains];
        domains.forEach(d => {
            if (typeof d !== "string") throw new TypeError("Domains must be string or array of string")
        });

        let on_running = false, trigger_cnt = 0;
        let func: () => any;
        const itvid = setInterval(func = async () => {
            if (on_running) return;
            if (that.timer.is_expired()) {
                that.timer.set_future();

                on_running = true;
                that.session.start();

                let trigger_id = genTimeBasedHash(this.identifier, false);
                that.output.log(`[#${trigger_cnt}] Timer triggered, ID: ${trigger_id}`);
                let status_record_array = await that.triggerUpdate(domains as string[])
                    .catch(err => {
                        that.output.error(err);
                        return [];
                    })
                that.output.log(`[#${trigger_cnt}] Trigger complete`);

                that.session.end();
                on_running = false;

                let message = that.genMsg(trigger_id, status_record_array, that.session.lines());

                this.output.log("Sending message...")
                let send_result = await that.sendMsg("[SSL Updater] 证书更新结果通知", message)
                    .catch(err => { that.output.error(err); })
                if (send_result === "cancel") this.output.log("Send canceled")
                else if (send_result === "failure") this.output.error("Send failed")
                else this.output.log("Send done")

                ++trigger_cnt;
            }
        }, 10 * 1000)
        func();

        this.watch_pool.add(itvid);
        return itvid;
    }

    /**
     * 触发更新
     * @param domains 检测的域名列表
     */
    abstract triggerUpdate(domains: string[]): Promise<any[]>;

    /**
     * 解析状态记录
     * @param trigger_id 触发 ID
     * @param record_list 状态记录列表
     * @param terminal_lines 终端输出
     */
    abstract genMsg(trigger_id: string, record_list: any[], terminal_lines: string[]): string;

    /**
     * 发送消息
     * @param title 消息标题
     * @param content 消息内容
     */
    abstract sendMsg(title: string, content: string): Promise<sendMsgStatus>;
}