module.exports = {
    qcloud: {
        secretId: "",
        secretKey: "",
        forceUploadDays: 15, // 距离证书过期多少天，强制上传证书
        startTime: '2024-02-01 04:00:00', // 第一次任务执行时间
        interval: 24 * 60 * 60 * 1000, // 每隔多少毫秒执行一次
        founder: "acme.sh" // 证书查找器（使用内置 acme.sh 查找器）
    },
    qiniu: {
        accessKey: "",
        secretKey: "",
        forceUploadDays: 15,
        startTime: '2024-02-01 16:00:00',
        interval: 24 * 60 * 60 * 1000,
        founder: "acme.sh"
    },
    mailserver: {
        smtp_host: "smtp.example.com",
        smtp_port: 465,
        smtp_secure: true,
        smtp_username: "notifications@example.com",
        smtp_password: "password",
        sender_name: "SSL Updater",
        sender_email: "notifications@exaple.com",
        receiver: ["example@receiver.com"]
    }
}