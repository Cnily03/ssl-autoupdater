const path = require("path")
const fs = require("fs")
const autossl = require("../dist")

const CONFIG = fs.existsSync(path.resolve(__dirname, "../config.self.js")) ? require("../config.self.js") : require("../config.js")

const mailOpts = {
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
}

const QCloudUpdater = new autossl.updater.QCloud(CONFIG.qcloud.secretId, CONFIG.qcloud.secretKey, {
    force_upload_days: CONFIG.qcloud.forceUploadDays,
    timer_start_time: CONFIG.qcloud.startTime,
    timer_interval: CONFIG.qcloud.interval,
    founder: CONFIG.qcloud.founder,
    mailer: new autossl.MailSender(mailOpts)
})

const QiniuUpdater = new autossl.updater.Qiniu(CONFIG.qiniu.accessKey, CONFIG.qiniu.secretKey, {
    force_upload_days: CONFIG.qiniu.forceUploadDays,
    timer_start_time: CONFIG.qiniu.startTime,
    timer_interval: CONFIG.qiniu.interval,
    founder: CONFIG.qiniu.founder,
    mailer: new autossl.MailSender(mailOpts)
})

QCloudUpdater.watch()
QiniuUpdater.watch()