const http = require('http');
const querystring = require('querystring');
const discord = require('discord.js');
const client = new discord.Client();
const config = require("./config.json")
const command = require("./lib/command.js")
const speech = new (require('./lib/speech.js'))(client)
const twitterPipeline = new (require('./lib/twitter-pipeline.js'))(client, error_handler=errorHandler)
const reminder = new (require("./lib/reminder"))(client, error_handler=errorHandler)
const cronCheck = require('cron-validator');


http.createServer(function(req, res){
  if (req.method == 'POST'){
    var data = "";
    req.on('data', function(chunk){
      data += chunk;
    });
    req.on('end', function(){
      if(!data){
        res.end("No post data");
        return;
      }
      var dataObject = querystring.parse(data);
      console.log("post:" + dataObject.type);
      if(dataObject.type == "wake"){
        console.log("Woke up in post");
        res.end();
        return;
      }
      res.end();
    });
  }
  else if (req.method == 'GET'){
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Discord Bot is active now\n');
  }
}).listen(3000);

client.on('ready', async message =>{
  console.log('Bot準備完了～');
  client.user.setPresence({ game: { name: 'げーむ' } });
  reminder.syncDB()
  twitterPipeline.syncDB()
});

client.on('message', message =>{
  if (message.author.id == client.user.id || message.author.bot){
    return;
  }
  if (message.content.match(/にゃ～ん|にゃーん/)){
    let text = "にゃ～ん";
    speech.msg(message.channel.id, text);
    return;
  }

  // リマインダー登録
  command.ifStartWith(message.content, config.command_prefix.reminder_create, async args => {
    if(args.length <= 1) throw "Invalid args."

    const cron = args[0].replace(/-/g, " ")
    const text = args.slice(1).join(" ").replace(/\\n/g, "\n")
    const is_valid_cron = await cronCheck.isValidCron(cron, {alias: true})

    if(is_valid_cron){
        await reminder.add(message.channel.id, cron, text, message.author.id)
        await speech.reply(message, config.messages.reminder_create_success)
    } else throw "Invalid cron syntax."
  }).catch(err => { errorHandler(message.channel.id, err) })

  // リマインダー取得
  command.ifStartWith(message.content, config.command_prefix.reminder_get, async args => {
    await speech.msg(message.channel.id, config.messages.reminder_get_result)

    const reminders = await reminder.get()
    return speech.embedMsg(message.channel.id, {
        color: config.color.safe,
        description: JSON.stringify(reminders, null, "　")
    })
  }).catch(err => { errorHandler(message.channel.id, err) })

  // リマインダー削除
  command.ifStartWith(message.content, config.command_prefix.reminder_delete, async args => {
    const id = args[0]
    const deleted_count = await reminder.delete(id)
    return speech.reply(message, deleted_count >= 1 ? config.messages.reminder_delete_success : config.messages.reject)
  }).catch(err => { errorHandler(message.channel.id, err) })

  // Twitterパイプライン作成
  command.ifStartWith(message.content, config.command_prefix.twitter_pipeline_create, async args => {
    if(args.length <= 0) throw "Invalid args."

    const twitter_user_screen_name = args[0].replace("@", "")
    const twitter_user = await twitterPipeline.getUserFromScreenName(twitter_user_screen_name)
    await twitterPipeline.add(message.channel.id, twitter_user.id_str)
    await speech.msg(message.channel.id, config.messages.twitter_pipeline_create_success)
  }).catch(err => { errorHandler(message.channel.id, err) })

  // Twitterパイプライン取得
  command.ifStartWith(message.content, config.command_prefix.twitter_pipeline_get, async args => {
    const userChannelNames = await twitterPipeline.getUserChannelNameMap()
    let pipeline_fields = []

    Object.keys(userChannelNames).forEach(user_id => {
      pipeline_fields.push({
        name: `@${userChannelNames[user_id].screen_name}`,
        value: `
          to #${userChannelNames[user_id].channel_name}
        `
      })
    })

    speech.embedMsg(message.channel.id, {
      color: config.color.twitter,
      fields: pipeline_fields
    })
  }).catch(err => { errorHandler(message.channel.id, err) })

  // Twitterパイプライン削除
  command.ifStartWith(message.content, config.command_prefix.twitter_pipeline_delete, async args => {
    if(args.length <= 0) throw "Invalid args."

    const twitter_user_screen_name = args[0].replace("@", "")
    const twitter_user = await twitterPipeline.getUserFromScreenName(twitter_user_screen_name)
    await twitterPipeline.delete(twitter_user.id_str)
    await speech.msg(message.channel.id, config.messages.twitter_pipeline_delete_success)
  }).catch(err => { errorHandler(message.channel.id, err) })

  // ヘルプ
  command.ifStartWith(message.content, config.command_prefix.help, async args => {
    return speech.embedMsg(message.channel.id, {
        color: config.color.safe,
        description: config.messages.help.join("\n")
    })
  }).catch(err => { errorHandler(message.channel.id, err) })
});

if(process.env.DISCORD_BOT_TOKEN == undefined){
 console.log('DISCORD_BOT_TOKENが設定されていません。');
 process.exit(0);
}

if(process.env.TWITTER_CONSUMER_KEY == undefined
    || process.env.TWITTER_CONSUMER_SECRET == undefined
    || process.env.TWITTER_ACCESS_TOKEN_KEY == undefined
    || process.env.TWITTER_ACCESS_TOKEN_SECRET == undefined
  ) {
  console.log('TWITTER_TOKENが設定されていません。');
  process.exit(0);
}

function errorHandler(channel_id, err) {
  console.error(err)

  switch(err) {
    case "Invalid args.":
      speech.msg(channel_id, config.messages.invalid_arg)
      break
    case "Invalid cron syntax.":
      speech.msg(channel_id, config.messages.invalid_cron_syntax)
      break
    default:
      speech.embedMsg(channel_id, {
          color: config.color.danger,
          description: JSON.stringify(err)
      })
  }
}

client.login( process.env.DISCORD_BOT_TOKEN );