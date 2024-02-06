export default class Cache {
    private cache: Record<string, any>;
    constructor() {
        this.cache = {}
    }

    set(key: any, value: any) {
        this.cache[JSON.stringify(key)] = value
    }

    get(key: any) {
        return this.cache[JSON.stringify(key)]
    }

    is_changed(key: any, value: any) {
        return this._different(this.cache[JSON.stringify(key)], value)
    }

    private _different(origin: any, coming: any) {
        if (typeof coming !== "object") return coming !== origin
        if (typeof origin !== "object") return true
        for (let k in coming) {
            if (!Object.prototype.hasOwnProperty.call(coming, k)) continue
            if (!Object.prototype.hasOwnProperty.call(origin, k)) return true
            if (typeof origin[k] !== typeof coming[k]) return true
            if (typeof coming[k] === "object" && this._different(origin[k], coming[k])) return true
            if (coming[k] !== origin[k]) return true
            return false
        }
        return true
    }
}