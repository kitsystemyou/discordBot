const schedule = require("node-schedule");
const config = require("../config.json")
const db = require("./database.js").load(config.data_path.reminder)

class Reminder {
    constructor(client) {
      this.client = client;
      this.db = db;
      this.speech = new (require("./speech.js"))(client)
    }

    async syncDB() {
        return new Promise(async (resolve, reject) => {
            // 現状されているスケジュールを全て解除
            await this.cancelAll()

            // DBから読み込んでスケジュール設定
            this.db.find({}, (err, reminders) => {
                if(err) reject(err)

                resolve(reminders.forEach(reminder => {
                    this.schedule(reminder.channel_id, reminder.cron, reminder.text)
                }))
            })
        })
    }

    async add(channelId, cronScheme, text) {
        return new Promise((resolve, reject) => {
            this.db.count({}, (err, count) => {
                if(err) reject(err)
                else if(count >= config.reminder_limit){
                    reject(`Reminder limit: ${config.reminder_limit}`)
                }else{
                    this.schedule(channelId, cronScheme, text)
                    resolve(this.db.insert({
                        channel_id: channelId,
                        cron: cronScheme,
                        text: text
                    }))
                }
            })
        })
    }

    async delete(id) {
        return new Promise((resolve, reject) => {
            this.db.remove({_id: id}, {}, (err, removed_count) => {
                if(err) reject(err)
                resolve(removed_count)
            })
        }).then(async removed_count => {
            await this.db.persistence.compactDatafile()
            return removed_count
        }).then(async removed_count => {
            await this.syncDB()
            return removed_count
        })
    }

    async get(options={}) {
        return new Promise((resolve, reject) => {
            this.db.find({}, (err, reminders) => {
                if(err) reject(err)
                resolve(reminders)
            })
        })
    }

    async schedule(channelId, cronScheme, text) {
        return schedule.scheduleJob(cronScheme, () => {
            this.speech.msg(channelId, text)
        });
    }

    async cancelAll() {
        return Object.values(schedule.scheduledJobs).map(job => {
            schedule.cancelJob(job.name);
        })
    }
}

module.exports = Reminder