# SSL AutoUpdater

This project is aimed to update SSL certificates (manually uploaded, such as Let's Encrypt) automatically on different server providers (QCloud, Aliyun, Qiniu, etc.).

- **Supported Providers**

  - [x] 腾讯云 (QCloud)
  - [x] 七牛云 (Qiniu)

## Usage

Make sure there are certificates on your machine, and this project will upload and update them automatically.

The default certificate founder is `acme.sh`, you can modify the option `founder` as a function to customize. For further instructions, please refer to the type definition.

### Node.js

Install the package

```shell
npm i -S ssl-autoupdater
```

Example:

```javascript
const autossl = require("ssl-autoupdater")

const QCloudUpdater = new autossl.updater.QCloud("your secretId", "your secretKey")
QCloudUpdater.watch() // watch and update automatically
```

Advanced usage for sending mail:

```javascript
const mailer = new autossl.MailSender({
  host: "smtp.example.com",
  port: 465,
  secure: true,
  auth: { // authentification for the smtp server
    username: "your auth username",
    password: "your auth password"
  },
  sender: { // set the sender
    name: "your name to send",
    email: "your email to send"
  },
  receiver: ["who@example.com"] // a list of receivers
})

const QCloudUpdater = new autossl.updater.QCloud("your secretId", "your secretKey", {
  mailer: mailer // when the option `mailer` is set, the updater will send mail once after triggering the event
})
```

More examples can be found in directory `test/`.

### Docker

Pull `cnily03/ssl-autoupdater` from Docker Hub

```shell
docker run -itd \
  -v /path/to/your/config.js:/app/data/config.js \
  -v ~/.acme.sh:/root/.acme.sh \
  --restart=always \
  --name ssl-autoupdater \
  cnily03/ssl-autoupdater
```

Replace `/path/to/your/config.js` with your own configuration file.

Or you can mount the whole directory to `/app/data/` to make it easier to manage.

Configuration file is similar to the file `config.js` at the root of this repository.

## References

- [tencentcloud-sdk-nodejs](https://github.com/TencentCloud/tencentcloud-sdk-nodejs)
- [developer.qiniu.com](https://developer.qiniu.com)

## License

CopyRight (c) Cnily03. All rights reserved.

Licensed under the [MIT](https://github.com/Cnily03/ssl-autoupdater?tab=MIT-1-ov-file) License.
