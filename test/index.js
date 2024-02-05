const path = require("path")
const fs = require("fs")
const autossl = require("../dist")

const CONFIG = fs.existsSync(path.resolve(__dirname, "../config.self.js")) ? require("../config.self.js") : require("../config.js")

const QCloudUpdater = new autossl.updater.QCloud(CONFIG.qcloud.secretId, CONFIG.qcloud.secretKey, {
    force_upload_days: CONFIG.qcloud.forceUploadDays,
    timer_start_time: CONFIG.qcloud.startTime,
    timer_interval: CONFIG.qcloud.interval,
    founder: CONFIG.qcloud.founder
})

const QiniuUpdater = new autossl.updater.Qiniu(CONFIG.qiniu.accessKey, CONFIG.qiniu.secretKey, {
    force_upload_days: CONFIG.qiniu.forceUploadDays,
    timer_start_time: CONFIG.qiniu.startTime,
    timer_interval: CONFIG.qiniu.interval,
    founder: CONFIG.qiniu.founder
})

QCloudUpdater.watch()
QiniuUpdater.watch()