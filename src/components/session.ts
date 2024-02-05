export class Session {
    private session_lines: string[];
    private on_session: boolean;
    constructor() {
        this.session_lines = [];
        this.on_session = false;
    }
    init() {
        this.session_lines = [];
        this.on_session = false;
    }
    start() {
        this.clear();
        this.on_session = true;
    }
    end() {
        this.on_session = false;
    }
    clear() {
        this.session_lines = [];
    }
    data() {
        return this.session_lines.join("\n");
    }
    lines() {
        return Array.from(this.session_lines);
    }
    alive() {
        return this.on_session;
    }
    appendLine(content: string, force: boolean = false) {
        if (force || this.alive()) this.session_lines.push(content);
    }
}