import { Session } from "@/components/session"
import "colors"

const date_string = () => new Date().toLocaleString().replace(/\/(\d)([^\d])/, "/0$1$2").replace(/\/(\d)([^\d])/, "/0$1$2").replace(/\//g, "-")

export class Output {
    private session: Session;
    public identifier: string;
    constructor(session: Session, identifier?: string) {
        this.session = session;
        if (typeof identifier === "string") {
            this.identifier = identifier
        } else {
            this.identifier = ""
        }
    }

    log(...args: any[]) {
        // each log message is gray
        args = args.map((arg: string) => arg.gray)
        args = [date_string().gray, `[LOG]`.gray, ...args]
        this.session.appendLine(args.join(" "));
        if (this.identifier) args.unshift(`[${this.identifier}]`.gray)
        return console.log(...args)
    }

    info(...args: any[]) {
        args = [date_string().gray, `[INFO]`.blue, ...args]
        this.session.appendLine(args.join(" "));
        if (this.identifier) args.unshift(`[${this.identifier}]`.gray)
        return console.info(...args)
    }

    warn(...args: any[]) {
        args = [date_string().gray, `[WARN]`.yellow, ...args]
        this.session.appendLine(args.join(" "));
        if (this.identifier) args.unshift(`[${this.identifier}]`.gray)
        return console.warn(...args)
    }

    error(...args: any[]) {
        args = [date_string().gray, `[ERROR]`.red, ...args]
        this.session.appendLine(args.join(" "));
        if (this.identifier) args.unshift(`[${this.identifier}]`.gray)
        return console.error(...args)
    }

    debug(...args: any[]) {
        args = [date_string().gray, `[DEBUG]`.magenta, ...args]
        this.session.appendLine(args.join(" "));
        if (this.identifier) args.unshift(`[${this.identifier}]`.gray)
        return console.log(...args)
    }

    success(...args: any[]) {
        args = [date_string().gray, `[SUCCESS]`.green, ...args]
        this.session.appendLine(args.join(" "));
        if (this.identifier) args.unshift(`[${this.identifier}]`.gray)
        return console.info(...args)
    }

    failure(...args: any[]) {
        args = [date_string().gray, `[FAILURE]`.red, ...args]
        this.session.appendLine(args.join(" "));
        if (this.identifier) args.unshift(`[${this.identifier}]`.gray)
        return console.info(...args)
    }
}