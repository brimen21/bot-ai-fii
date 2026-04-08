require("dotenv").config();

const {
Client,
GatewayIntentBits,
ActionRowBuilder,
ButtonBuilder,
ButtonStyle,
EmbedBuilder,
ChannelType,
PermissionsBitField,
MessageFlags
} = require("discord.js");

const Groq = require("groq-sdk");
const fs = require("fs");

const client = new Client({
intents:[
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.GuildMembers
]
});

const groq = new Groq({
apiKey: process.env.GROQ_API_KEY
});

/* ================= CONFIG ROLE ================= */

const PREMIUM_ROLE = process.env.PREMIUM_ROLE
const ADMIN_ROLE = process.env.ADMIN_ROLE
const DEV_ROLE = process.env.DEV_ROLE
const OWNER_ID = process.env.OWNER_ID

/* ================= DATABASE ================= */

const memory = new Map()
const cooldown = new Map()
const userChannels = new Map()

const MODEL = process.env.AI_MODEL || "llama-3.3-70b-versatile"

/* ================= PANEL BUTTON ================= */

client.once("clientReady", async () => {

console.log(`Bot online sebagai ${client.user.tag}`);

const channelId = process.env.PANEL_CHANNEL
if(!channelId) return

const channel = await client.channels.fetch(channelId)

const embed = new EmbedBuilder()
.setTitle("AI Chat Bot")
.setDescription("Tekan tombol di bawah untuk membuat channel chat dengan AI\nCreate By Fii.")
.setColor("Blue")

const row = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId("buat_chat_ai")
.setLabel("🧠 Buat Chat AI")
.setStyle(ButtonStyle.Success)
)

channel.send({
embeds:[embed],
components:[row]
})

})

/* ================= BUTTON HANDLER ================= */

client.on("interactionCreate", async interaction => {

if(!interaction.isButton()) return

/* ===== BUAT CHANNEL ===== */

if(interaction.customId === "buat_chat_ai"){

const member = await interaction.guild.members.fetch(interaction.user.id)

if(!member.roles.cache.has(PREMIUM_ROLE)){
return interaction.reply({
content:"❌ Hanya user **Premium** yang bisa membuat tiket AI.",
flags: MessageFlags.Ephemeral
})
}

if(userChannels.has(interaction.user.id)){
return interaction.reply({
content:`Kamu sudah punya channel AI: <#${userChannels.get(interaction.user.id)}>`,
flags: MessageFlags.Ephemeral
})
}

const parent = interaction.channel.parent
const position = interaction.channel.rawPosition + 1

const newChannel = await interaction.guild.channels.create({
name:`ai-chat-${interaction.user.username}`,
type:ChannelType.GuildText,
parent: parent,
position: position,
permissionOverwrites:[
{
id:interaction.guild.id,
deny:[PermissionsBitField.Flags.ViewChannel]
},
{
id:interaction.user.id,
allow:[
PermissionsBitField.Flags.ViewChannel,
PermissionsBitField.Flags.SendMessages,
PermissionsBitField.Flags.ReadMessageHistory
]
}
]
})

if(ADMIN_ROLE){
newChannel.permissionOverwrites.create(ADMIN_ROLE,{
ViewChannel:true,
SendMessages:true
})
}

if(DEV_ROLE){
newChannel.permissionOverwrites.create(DEV_ROLE,{
ViewChannel:true,
SendMessages:true
})
}

if(OWNER_ID){
newChannel.permissionOverwrites.create(OWNER_ID,{
ViewChannel:true,
SendMessages:true
})
}

userChannels.set(interaction.user.id,newChannel.id)

const embed = new EmbedBuilder()
.setTitle("Chat AI Dibuat")
.setDescription("Silakan kirim pesan langsung ke AI 🤖")
.setColor("Green")

const row = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId("akhiri_chat_ai")
.setLabel("🛑 Akhiri Chat")
.setStyle(ButtonStyle.Danger)
)

await newChannel.send({
content:`${interaction.user}`,
embeds:[embed],
components:[row]
})

interaction.reply({
content:`Channel AI berhasil dibuat: ${newChannel}`,
flags: MessageFlags.Ephemeral
})

}

/* ===== AKHIRI CHAT + TRANSCRIPT ===== */

if(interaction.customId === "akhiri_chat_ai"){

await interaction.reply({
content:"Menyimpan log chat...",
flags: MessageFlags.Ephemeral
})

await sendTranscript(interaction.channel, interaction.user.tag)

userChannels.delete(interaction.user.id)
memory.delete(interaction.channel.id)

setTimeout(()=>{
interaction.channel.delete().catch(()=>{})
},2000)

}

})

/* ================= AUTO CLOSE JIKA PREMIUM HILANG ================= */

client.on("guildMemberUpdate", async (oldMember, newMember) => {

if(oldMember.roles.cache.has(PREMIUM_ROLE) && !newMember.roles.cache.has(PREMIUM_ROLE)){

const channelId = userChannels.get(newMember.id)
if(!channelId) return

const channel = newMember.guild.channels.cache.get(channelId)

if(channel){

await channel.send("❌ Role Premium kamu sudah tidak ada. Tiket otomatis ditutup.")

await sendTranscript(channel, newMember.user.tag)

setTimeout(()=>{
channel.delete().catch(()=>{})
},5000)

}

userChannels.delete(newMember.id)

}

})

/* ================= FUNGSI TRANSCRIPT ================= */

async function sendTranscript(channel, userTag){

try{

const messages = await channel.messages.fetch({ limit:100 })

const sorted = Array.from(messages.values()).sort((a,b)=>a.createdTimestamp-b.createdTimestamp)

let transcript = `AI CHAT TRANSCRIPT\n`
transcript += `Server : ${channel.guild.name}\n`
transcript += `Channel : ${channel.name}\n`
transcript += `User : ${userTag}\n`
transcript += `Tanggal : ${new Date().toLocaleString()}\n`
transcript += `\n---------------------------------------\n\n`

sorted.forEach(msg=>{
const name = msg.author.bot ? "AI" : msg.author.username
transcript += `[${name}] ${msg.content}\n\n`
})

const fileName = `ai-chat-${Date.now()}.txt`

fs.writeFileSync(fileName, transcript)

const logChannelId = process.env.LOG_CHANNEL

if(logChannelId){

try{

const logChannel = await channel.guild.channels.fetch(logChannelId)

if(logChannel){

await logChannel.send({
content:`📄 Transcript chat AI dari ${userTag}`,
files:[fileName]
})

}

}catch(err){
console.log("LOG CHANNEL ERROR:",err)
}

}

fs.unlinkSync(fileName)

}catch(err){
console.log(err)
}

}

/* ================= AI CHAT ================= */

client.on("messageCreate", async (message) => {

if(message.author.bot) return
if(!message.channel.name.startsWith("ai-chat")) return

if(cooldown.has(message.author.id)){
return message.reply("Tunggu sebentar sebelum bertanya lagi ⏳")
}

cooldown.set(message.author.id,true)
setTimeout(()=>{ cooldown.delete(message.author.id) },3000)

if(!memory.has(message.channel.id)){
memory.set(message.channel.id,[
{ role:"system", content:"Kamu adalah AI assistant yang ramah dan membantu." }
])
}

const chatMemory = memory.get(message.channel.id)

chatMemory.push({
role:"user",
content:message.content
})

try{

await message.channel.sendTyping()

const chat = await groq.chat.completions.create({
messages: chatMemory,
model: MODEL
})

const reply = chat.choices[0].message.content

chatMemory.push({
role:"assistant",
content:reply
})

if(chatMemory.length > 20){
chatMemory.splice(1,2)
}

message.reply(reply)

}catch(error){

console.log(error)
message.reply("AI sedang error, coba lagi.")

}

})

client.login(process.env.DISCORD_TOKEN);
