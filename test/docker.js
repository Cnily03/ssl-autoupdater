const path = require("path")
const fs = require("fs")
const autossl = require("../dist")

const CONF_PATH = "/app/data/config.js"
if (!fs.existsSync(CONF_PATH)) {
    console.error("Config file not found at " + CONF_PATH)
    process.exit(1)
}

let is_watch = false

// const CONFIG = require("../config.js")
const CONFIG = require(CONF_PATH)

const mailOpts = () => ({
    host: CONFIG.mailserver.smtp_host,
    port: CONFIG.mailserver.smtp_port,
    secure: CONFIG.mailserver.smtp_secure,
    auth: {
        username: CONFIG.mailserver.smtp_username,
        password: CONFIG.mailserver.smtp_password
    },
    sender: {
        name: CONFIG.mailserver.sender_name,
        email: CONFIG.mailserver.sender_email
    },
    receiver: CONFIG.mailserver.receiver
})

const QCloudBaseOpts = () => ({
    force_upload_days: CONFIG.qcloud.forceUploadDays,
    timer_start_time: CONFIG.qcloud.startTime,
    timer_interval: CONFIG.qcloud.interval,
    founder: CONFIG.qcloud.founder
})

const QiniuBaseOpts = () => ({
    force_upload_days: CONFIG.qiniu.forceUploadDays,
    timer_start_time: CONFIG.qiniu.startTime,
    timer_interval: CONFIG.qiniu.interval,
    founder: CONFIG.qiniu.founder
})

console.info(CONFIG.mailserver.enable ?
    "[Function] Mail server enabled" :
    "[Function] Mail server disabled")
console.info(CONFIG.qcloud.enable ?
    "[Updater] QCloud enabled" :
    "[Updater] QCloud disabled")
console.info(CONFIG.qiniu.enable ?
    "[Updater] Qiniu enabled" :
    "[Updater] Qiniu disabled")


if (CONFIG.qcloud.enable) {
    let opts = QCloudBaseOpts()
    if (CONFIG.mailserver.enable) opts.mailer = new autossl.MailSender(mailOpts())
    const QCloudUpdater = new autossl.updater.QCloud(CONFIG.qcloud.secretId, CONFIG.qcloud.secretKey, opts)
    QCloudUpdater.watch()
    is_watch = true
}

if (CONFIG.qiniu.enable) {
    let opts = QiniuBaseOpts()
    if (CONFIG.mailserver.enable) opts.mailer = new autossl.MailSender(mailOpts())
    const QiniuUpdater = new autossl.updater.Qiniu(CONFIG.qiniu.accessKey, CONFIG.qiniu.secretKey, opts)
    QiniuUpdater.watch()
    is_watch = true
}

if (!is_watch) {
    console.log("No updater enabled. Please stop the container.")
    process.stdin.resume();
}