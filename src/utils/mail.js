const Mailer = require('nodemailer');
const ejs = require('ejs');

class Template {
    constructor() {
        this._data = ""
    }
    /**
     * @param {string} content
     */
    set(content) {
        this._data = content;
    }
    get() {
        return this._data;
    }
    render(args) {
        return ejs.render(this._data, args);
    }
}

class MailSender {
    /**
     * Creates a new instance of the Mail class
     * @param {Object} options - The options for configuring the mailer
     * @param {string} options.host - The SMTP server host
     * @param {number} options.port - The SMTP server port
     * @param {boolean} options.secure - Indicates if the connection should use SSL/TLS
     * @param {Object} options.auth - The authentication credentials
     * @param {string} options.auth.username - The username for authentication
     * @param {string} options.auth.password - The password for authentication
     */
    constructor(options = { host, port, secure, auth: { username, password } }) {
        this.transporter = Mailer.createTransport({
            host: host,
            port: port,
            secure: secure,
            auth: {
                user: username,
                pass: password
            }
        });

        this.sender = {
            name: username,
            email: /@[^\.]+\.[^\.]+$/.test(username) ? username : `${username}@${host}`
        }
        this._receiver = new Set();

        this.Template = {
            Text: new Template(),
            HTML: new Template()
        }
    }

    setSender(name, email) {
        this.sender.name = name || this.sender.name;
        this.sender.email = email || this.sender.email;
    }

    setSenderName(name) {
        this.sender.name = name;
    }

    setSenderEmail(email) {
        this.sender.email = email;
    }

    addReceiver(...args) {
        args.forEach(arg => this._receiver.add(arg));
    }

    removeReceiver(...args) {
        args.forEach(arg => this._receiver.delete(arg));
    }

    setReceiver(...args) {
        this._receiver = new Set(args);
    }

    get receivers() {
        return Array.from(this._receiver);
    }

    /**
     * Sends an email with the specified subject and content
     * @param {string} subject - The subject of the email
     * @param {"html" | "text"} type - The type of content
     * @param {string} content - The content of the email
     * @returns {Promise<void>}
     */
    async send(subject, type, content) {
        let format_name = this.sender.name.replace(/"/g, '\\"');
        if (this._receiver.length === 0) throw new Error("No receiver specified.");
        let mailOptions = {
            from: `"${format_name}" <${this.sender.email}>`,
            to: this.receivers.join(", "),
            subject: subject,
        };
        if (type === "html") mailOptions.html = content;
        else mailOptions.text = content;
        return await this.transporter.sendMail(mailOptions)
            .catch(err => { console.error("[MAILER]", "[ERROR]", err); });
    }
}

module.exports = MailSender;