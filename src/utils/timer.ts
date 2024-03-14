type DateLike = number | string | Date

type TimerWatchCallBack<T> = (run_time: number) => T
type TimerWatchOptions = {
    /**
     * Prevent the callback from being called when the former callback is still running
     * @default true
     */
    preventWhenRunning?: boolean
    /**
     * Run the callback instantly when the timer is started
     * @default false
     */
    InstantlyRun?: boolean
}

export class Timer {

    private _start_time: number;
    private _interval: number;
    public appoint: number;

    constructor(start_time: DateLike, interval: number) {

        this._start_time = new Date(start_time).getTime();
        if (Number.isNaN(this._start_time)) throw new TypeError("start_time must be a valid date");
        this._interval = interval;
        if (typeof this._interval !== "number") throw new TypeError("interval must be a number");
        else this._interval = Math.abs(this._interval);

        this.nearest_start_time();
        this.appoint = this.future();
    }

    static now() {
        return Date.now ? Date.now() : new Date().getTime()
    }

    /**
     * Update start time to what is most close to now
     */
    nearest_start_time() {
        let nowTime = Timer.now();
        if (nowTime < this._start_time) return this._start_time; // future, waiting for its coming
        let possible = Math.floor((nowTime - this._start_time) / this._interval) * this._interval + this._start_time;
        if (possible > nowTime) possible -= this._interval;
        return this._start_time = possible;
    }

    /**
     * Watch the timer and call the callback when the time is up
     */
    watch(callback: TimerWatchCallBack<any>, opts: TimerWatchOptions) {
        if (!Object.prototype.hasOwnProperty.call(opts, "preventWhenRunning")) {
            opts.preventWhenRunning = true;
        }
        if (!Object.prototype.hasOwnProperty.call(opts, "InstantlyRun")) {
            opts.InstantlyRun = false;
        }

        function isAsync(fn: Function): fn is TimerWatchCallBack<Promise<any>> {
            return typeof fn === "function" && fn.constructor.name === "AsyncFunction";
        }

        let system_prevent = false; // prevent when one schedule is running
        let user_prevent = false; // only prevent calling the callback

        let force_run = Boolean(opts.InstantlyRun);
        const itvid = setInterval(() => {
            if (system_prevent) return;
            system_prevent = true;

            if (opts.preventWhenRunning && user_prevent) return;

            if (this.is_expired() || force_run) {
                force_run = false;
                let callingTime = this.appoint;
                this.set_future();
                this.nearest_start_time();
                system_prevent = false;

                user_prevent = true;
                // The parameter `callback` might be delivered by reference
                // That means it might be changed in calls at different calling time
                // So we need to check it (async or sync) every time before calling it
                if (isAsync(callback)) {
                    callback(callingTime).finally(() => {
                        user_prevent = false;
                    })
                } else if (typeof callback === "function") {
                    callback(callingTime);
                    user_prevent = false;
                }
            } else {
                system_prevent = false;
            }
        }, 1000);
        return itvid;
    }

    next() {
        return this.appoint + this._interval;
    }

    future() {
        let nowTime = Timer.now();
        if (nowTime < this._start_time) return this._start_time; // future, waiting for its coming
        let result = Math.floor((nowTime - this._start_time) / this._interval) * this._interval + this._start_time;
        while (result <= nowTime) result += this._interval;
        return result;
    }

    is_expired() {
        return this.appoint < Timer.now();
    }

    set_next() {
        return this.appoint = this.next();
    }

    set_future() {
        return this.appoint = this.future();
    }
}

export default Timer;