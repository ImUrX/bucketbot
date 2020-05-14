const Discord = require("discord.js");
const { BlobServiceClient, StorageSharedKeyCredential } = require("@azure/storage-blob");
const config = require("./config.json");
const auth = require("./auth.json");
const client = new Discord.Client();

const sharedKeyCredential = new StorageSharedKeyCredential(auth.azure.account, auth.azure.key);
const blobServiceClient = new BlobServiceClient(`https://${auth.azure.account}.blob.core.windows.net`, sharedKeyCredential);
client.blobFolders = new Map();

const getList = async () => {
	const container = blobServiceClient.getContainerClient(auth.container);
	client.blobFolders.clear();
	const random = [];
	for await(const blob of container.listBlobsFlat()) {
		random.push({ name: blob.name, type: blob.properties.contentType });
	}
	client.blobFolders.set("random", random);
	for await(const blob of container.listBlobsByHierarchy("/")) {
		if(blob.kind !== "prefix") continue;
		const files = [];
		for await(const imblob of container.listBlobsByHierarchy(`${blob.name}`, { prefix: blob.name })) {
			if(imblob.kind === "blob") files.push({ name: imblob.name, type: imblob.properties.contentType });
		}
		client.blobFolders.set(blob.name.substring(0, blob.name.length - 1), files);
	}
};

client.on("ready", () => {
	console.log(`Logged in as ${client.user.tag}!`);
	getList();
	client.setInterval(getList, config.fetchEvery);
});

const randomHandler = (msg, folder) => {
	if(config.nsfw && !msg.channel.nsfw) return msg.channel.send("Image is NSFW!"); 
	const selected = folder[Math.floor(Math.random() * folder.length)];

	if(!selected.type.toLowerCase().startsWith("image")) {
		return msg.channel.send(
			new Discord.MessageAttachment(`https://${auth.azure.account}.blob.core.windows.net/${auth.container}/${
				encodeURIComponent(selected.name)
			}`)
		);
	}

	const embed = new Discord.MessageEmbed()
		.setImage(`https://${auth.azure.account}.blob.core.windows.net/${auth.container}/${
			encodeURIComponent(selected.name)
		}`);
	return msg.channel.send(embed);
};

const cooldown = new Set();
const addToCooldown = async (id) => {
	const owner = (await client.fetchApplication()).owner;
	if(owner instanceof Discord.User) {
		if(owner.id === id) return;
	} else if(owner instanceof Discord.Team) {
		if(owner.members.has(owner)) return;
	}
	cooldown.add(id);
	client.setTimeout(() => {
		cooldown.delete(id);
	}, config.cooldown * 1000);
};

client.on("message", msg => {
	const command = msg.content.toLowerCase();
	if(msg.author.bot || !command.startsWith(config.prefix) || cooldown.has(msg.author.id)) return;
	for(const [name, folder] of client.blobFolders) {
		if(command.startsWith(`${config.prefix}${name}`.toLowerCase())) {
			addToCooldown(msg.author.id);
			return randomHandler(msg, folder);
		}
	}
	if(command.startsWith(`${config.prefix}help`)) {
		addToCooldown(msg.author.id);
		return msg.channel.send(`Current commands: \`\`${[...client.blobFolders.keys()].join("``, ``")}\`\``);
	}
});

client.login(auth.token);