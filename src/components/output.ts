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

    private _output(consoleFunc: Function, append: string[], args: any[]) {
        let date_str = date_string().gray
        let append_str = append.join(" ")
        let session_output = [date_str, append_str, ...args]
        let console_output = [date_str, `[${this.identifier}]`.gray, append_str, ...args]
        this.session.appendLine(session_output.join(" "));
        return consoleFunc(...console_output)
    }

    log(...args: any[]) {
        // each log message is gray
        args = args.map((arg: any) => {
            if (typeof arg === "string") return arg.gray
            else return arg
        })
        return this._output(console.log, ["[LOG]".gray], args)
    }

    info(...args: any[]) {
        return this._output(console.info, ["[INFO]".blue], args)
    }

    warn(...args: any[]) {
        return this._output(console.warn, ["[WARN]".yellow], args)
    }

    error(...args: any[]) {
        return this._output(console.error, ["[ERROR]".red], args)
    }

    debug(...args: any[]) {
        return this._output(console.log, ["[DEBUG]".magenta], args)
    }

    success(...args: any[]) {
        return this._output(console.info, ["[SUCCESS]".green], args)
    }

    failure(...args: any[]) {
        return this._output(console.info, ["[FAILURE]".red], args)
    }
}