import Mailer from 'nodemailer'
import ejs from 'ejs'
import Mail from 'nodemailer/lib/mailer';

export class Template {
    private _data: string;
    constructor() {
        this._data = ""
    }
    /**
     * @param {string} content
     */
    set(content: string) {
        this._data = content;
    }
    get() {
        return this._data;
    }
    render(args: any) {
        return ejs.render(this._data, args);
    }
}

export type MailSenderOptions = {
    /**
     * The SMTP server host
     */
    host: string,
    /**
     * The SMTP server port
     */
    port: number,
    /**
     * Indicates if the connection should use SSL/TLS
     */
    secure: boolean,
    /**
     * The authentication credentials
     */
    auth: {
        /**
         * The username for authentication
         */
        username: string,
        /**
         * The password for authentication
         */
        password: string
    },
    /**
     * The sender of the email
     */
    sender?: {
        name: string,
        email: string
    },
    /**
     * The receivers of the email
     */
    receiver?: string[],
}

export class MailSender {
    private transporter;
    private sender: {
        name: string,
        email: string
    }
    private _receiver: Set<string>;
    public Template;

    constructor(options: MailSenderOptions) {
        const host = options.host;
        const username = options.auth.username;

        this.transporter = Mailer.createTransport({
            host: options.host,
            port: options.port,
            secure: options.secure,
            auth: {
                user: options.auth.username,
                pass: options.auth.password
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

        if (options.sender) {
            this.setSender(options.sender.name, options.sender.email);
        }

        if (options.receiver) {
            this.setReceiver(...options.receiver);
        }
    }

    setSender(name: string, email: string) {
        this.sender.name = name || this.sender.name;
        this.sender.email = email || this.sender.email;
    }

    setSenderName(name: string) {
        this.sender.name = name;
    }

    setSenderEmail(email: string) {
        this.sender.email = email;
    }

    addReceiver(...args: string[]) {
        args.forEach(arg => this._receiver.add(arg));
    }

    removeReceiver(...args: string[]) {
        args.forEach(arg => this._receiver.delete(arg));
    }

    setReceiver(...args: string[]) {
        this._receiver = new Set(args);
    }

    get receivers() {
        return Array.from(this._receiver);
    }

    /**
     * Sends an email with the specified subject and content
     * @param subject The subject of the email
     * @param type The type of content
     * @param content The content of the email
     */
    async send(subject: string, type: "html" | "text", content: string) {
        if (this.receivers.length === 0) throw new Error("No receiver specified.");
        let fmt_name = this.sender.name.replace(/"/g, '\\"');
        let mailOptions: Mail.Options = {
            from: `"${fmt_name}" <${this.sender.email}>`,
            to: this.receivers.join(", "),
            subject: subject,
        };
        if (type === "html") mailOptions.html = content;
        else mailOptions.text = content;
        return await this.transporter.sendMail(mailOptions)
            .catch(err => { console.error("[MAILER]", "[ERROR]", err); });
    }
}

export default MailSender;