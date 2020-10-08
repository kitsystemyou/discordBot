const http = require('http');
const querystring = require('querystring');
const discord = require('discord.js');
const client = new discord.Client();
const config = require("./config.json")
const command = require("./lib/command.js")
const speech = new (require('./lib/speech.js'))(client)
const reminder = new (require("./lib/reminder"))(client)
const cronCheck = require('cron-validator');

reminder.syncDB()

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

client.on('ready', message =>{
  console.log('Bot準備完了～');
  client.user.setPresence({ game: { name: 'げーむ' } });
});

client.on('message', message =>{
  if (message.author.id == client.user.id || message.author.bot){
    return;
  }
  if(message.isMemberMentioned(client.user)){
    speech.reply(message, "呼びましたか？");
    return;
  }
  if (message.content.match(/にゃ～ん|にゃーん/)){
    let text = "にゃ～ん";
    speech.msg(message.channel.id, text);
    return;
  }

  // リマインダー登録
  command.ifStartWith(message.content, config.reminder_create_prefix, async args => {
    if(args.length <= 1) throw "Invalid args."

    const cron = args[0].replace(/-/g, " ")
    const text = args.slice(1).join(" ")
    const is_valid_cron = await cronCheck.isValidCron(cron)

    if(is_valid_cron){
        await reminder.add(message.channel.id, cron, text)
        await speech.reply(message, config.reminder_create_success_message)
    } else throw "Invalid cron syntax."
  }).catch(err => { erorrHandler(message, err) })

  // リマインダー取得
  command.ifStartWith(message.content, config.reminder_get_prefix, async args => {
    await speech.msg(message.channel.id, config.reminder_get_result_message)

    const reminders = await reminder.get()
    speech.reply(message, {embed: {
        color: 0x00e191,
        description: JSON.stringify(reminders, null, "　")
    }})
  }).catch(err => { erorrHandler(message, err) })

  // リマインダー削除
  command.ifStartWith(message.content, config.reminder_delete_prefix, async args => {
    const id = args[0]
    const deleted_count = await reminder.delete(id)
    return speech.reply(message, deleted_count >= 1 ? config.reminder_delete_success_message : config.reject_message)
  }).catch(err => { erorrHandler(message, err) })

  // ヘルプ
  command.ifStartWith(message.content, config.help_prefix, async args => {
    return speech.reply(message, {embed: {
        color: 0x00e191,
        description: config.help_message.join("\n")
    }})
  }).catch(err => { erorrHandler(message, err) })
});

if(process.env.DISCORD_BOT_TOKEN == undefined){
 console.log('DISCORD_BOT_TOKENが設定されていません。');
 process.exit(0);
}

function erorrHandler(message, err) {
  console.error(err)

  switch(err) {
    case "Invalid args.":
      speech.msg(message.channel.id, config.invalid_arg_message)
      break
    case "Invalid cron syntax.":
      speech.msg(message.channel.id, config.invalid_cron_syntax_message)
      break
    default:
      speech.msg(message.channel.id, config.error_message)
      speech.reply(message, {embed: {
          color: 0xff0000,
          description: err.toString()
      }})
  }
}

client.login( process.env.DISCORD_BOT_TOKEN );