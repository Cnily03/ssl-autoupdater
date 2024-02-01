class Timer {
    /**
     * @param {number | string | Date} start_time
     * @param {number} interval
     */
    constructor(start_time, interval) {

        this._start_time = new Date(start_time).getTime();
        if (Number.isNaN(this._start_time)) throw new TypeError("start_time must be a valid date");
        this._interval = interval;
        if (typeof this._interval !== "number") throw new TypeError("interval must be a number");
        else if (this._interval <= 0) this._interval = 24 * 60 * 60 * 1000;
        // record 只用于记录 interval 到达的时间，并不会自动同步
        // 自动同步需要外部使用 setInterval 不断调用 set_future
        if (Timer.now() < this._start_time) this.record = this._start_time;
        else this.record = Math.floor((Timer.now() - this._start_time) / this._interval) * this._interval + this._start_time;
    }

    static now() {
        return Date.now ? Date.now() : new Date().getTime()
    }

    next() {
        return this.record += this._interval;
    }

    future() {
        if (Timer.now() < this._start_time) return this._start_time;
        let result = (Math.floor((Timer.now() - this._start_time) / this._interval) + 1) * this._interval + this._start_time;
        // ensure no bugs
        let now = Timer.now();
        while (result < now) result += this._interval;
        return result;
    }

    is_expired() {
        return this.record < Timer.now();
    }

    set_next() {
        this.record = this.next();
    }

    set_future() {
        this.record = this.future();
    }
}

module.exports = Timer;