// Plugin by MySquadStats.com - @psg_ignis
// DO NOT EDIT THIS FILE

import axios from "axios";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

import BasePlugin from "./base-plugin.js";

const currentVersion = "v5.0.1";

export default class MySquadStats extends BasePlugin {
  static get description() {
    return "The <code>MySquadStats/code> plugin will log various server statistics and events to a central database for player stat tracking.";
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      accessToken: {
        required: true,
        description: "The access token to use for the database.",
        default: "YOUR_ACCESS_TOKEN", // DO NOT MODIFY THIS - Change this in config.json!
      },
      allowInGameStatsCommand: {
        required: false,
        description:
          "Allow players to check their stats in-game via an AdminWarn.",
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.onChatCommand = this.onChatCommand.bind(this);
    this.onRoundEnded = this.onRoundEnded.bind(this);
    this.onNewGame = this.onNewGame.bind(this);
    this.onPlayerConnected = this.onPlayerConnected.bind(this);
    this.onPlayerWounded = this.onPlayerWounded.bind(this);
    this.onPlayerDied = this.onPlayerDied.bind(this);
    this.onPlayerRevived = this.onPlayerRevived.bind(this);
    this.isProcessingFailedRequests = false;
    // Killstreaks
    this.trackedKillstreaks = {};
    this.killstreakWounded = this.killstreakWounded.bind(this);
    this.killstreakDied = this.killstreakDied.bind(this);
    this.killstreakNewGame = this.killstreakNewGame.bind(this);
    this.killstreakDisconnected = this.killstreakDisconnected.bind(this);
  }

  async prepareToMount() {}

  async mount() {
    // Post Request to create Server in API
    let dataType = "servers";
    const serverData = {
      name: this.server.serverName,
      version: currentVersion,
    };
    const response = await postDataToAPI(
      dataType,
      serverData,
      this.options.accessToken
    );
    this.verbose(
      1,
      `Mount-Server | ${response.successStatus} | ${response.successMessage}`
    );

    // Get Request to get Match Info from API
    dataType = "matches";
    const matchResponse = await getDataFromAPI(
      dataType,
      this.options.accessToken
    );
    this.match = matchResponse.match;
    this.verbose(
      1,
      `Mount-Match | ${matchResponse.successStatus} | ${matchResponse.successMessage}`
    );

    // Get Admins
    const admins = await this.server.getAdminsWithPermission("canseeadminchat");
    // Make a players request to the API for each admin
    for (let i = 0; i < admins.length; i++) {
      const adminId = admins[i];
      let playerData = {};

      if (adminId.length === 17) {
        playerData = {
          steamID: adminId,
          isAdmin: 1,
        };
      } else {
        playerData = {
          eosID: adminId,
          isAdmin: 1,
        };
      }

      const dataType = "players";
      const response = await patchDataInAPI(
        dataType,
        playerData,
        this.options.accessToken
      );
      // Only log the response if it's an error
      if (response.successStatus === "Error") {
        this.verbose(
          1,
          `Mount-Admins | ${response.successStatus} | ${response.successMessage}`
        );
      }
    }

    // Subscribe to events
    this.server.on(`CHAT_COMMAND:mss`, this.onChatCommand);
    this.server.on("ROUND_ENDED", this.onRoundEnded);
    this.server.on("NEW_GAME", this.onNewGame);
    this.server.on("PLAYER_CONNECTED", this.onPlayerConnected);
    this.server.on("PLAYER_WOUNDED", this.onPlayerWounded);
    this.server.on("PLAYER_DIED", this.onPlayerDied);
    this.server.on("PLAYER_REVIVED", this.onPlayerRevived);
    this.server.on("PLAYER_WOUNDED", this.killstreakWounded);
    this.server.on("PLAYER_DIED", this.killstreakDied);
    this.server.on("NEW_GAME", this.killstreakNewGame);
    this.server.on("PLAYER_DISCONNECTED", this.killstreakDisconnected);
    // Check for updates in GitHub
    this.checkVersion();
    // Every minute, ping My Squad Stats
    this.pingInterval = setInterval(this.pingMySquadStats.bind(this), 60000);
    // Every 30 minutes, get the admins from the server and update the database
    this.getAdminsInterval = setInterval(this.getAdmins.bind(this), 1800000);
  }

  async unmount() {
    this.server.removeEventListener(`CHAT_COMMAND:mss`, this.onChatCommand);
    this.server.removeEventListener("ROUND_ENDED", this.onRoundEnded);
    this.server.removeEventListener("NEW_GAME", this.onNewGame);
    this.server.removeEventListener("PLAYER_CONNECTED", this.onPlayerConnected);
    this.server.removeEventListener("PLAYER_WOUNDED", this.onPlayerWounded);
    this.server.removeEventListener("PLAYER_DIED", this.onPlayerDied);
    this.server.removeEventListener("PLAYER_REVIVED", this.onPlayerRevived);
    this.server.removeEventListener("PLAYER_WOUNDED", this.killstreakWounded);
    this.server.removeEventListener("PLAYER_DIED", this.killstreakDied);
    this.server.removeEventListener("NEW_GAME", this.killstreakNewGame);
    this.server.removeEventListener(
      "PLAYER_DISCONNECTED",
      this.killstreakDisconnected
    );
    clearInterval(this.pingInterval);
    clearInterval(this.getAdminsInterval);
  }

  async checkVersion() {
    const owner = "Ignis-Bots";
    const repo = "SquadJS-My-Squad-Stats";
    let latestVersion;

    try {
      latestVersion = await getLatestVersion(owner, repo);
    } catch (error) {
      this.verbose(
        1,
        `Error retrieving the latest version of ${repo} from ${owner}:`,
        error
      );
    }

    const __DataDirname = fileURLToPath(import.meta.url);
    // Create Update Cleared File
    const updateClearedFilePath = path.join(
      __DataDirname,
      "..",
      "..",
      "MySquadStats_Data",
      "update-cleared.json"
    );

    // Create Update Cleared if not exists with cleared: false
    if (!fs.existsSync(updateClearedFilePath)) {
      const data = JSON.stringify({ cleared: false }, null, 2);
      fs.writeFileSync(updateClearedFilePath, data);
    }

    // If no update-cleared.json is false
    const updateCleared = JSON.parse(fs.readFileSync(updateClearedFilePath));
    if (!updateCleared.cleared) {
      // Delete old Retry Json Files due to potential conflicting changes in the code
      const retryPostFilePath = path.join(
        __DataDirname,
        "..",
        "..",
        "MySquadStats_Data",
        "send-retry-requests.json"
      );
      if (fs.existsSync(retryPostFilePath)) {
        fs.unlinkSync(retryPostFilePath);
      }

      const retryPatchFilePath = path.join(
        __DataDirname,
        "..",
        "..",
        "MySquadStats_Data",
        "patch-retry-requests.json"
      );
      if (fs.existsSync(retryPatchFilePath)) {
        fs.unlinkSync(retryPatchFilePath);
      }

      // Create the update-cleared.json file
      fs.writeFileSync(
        updateClearedFilePath,
        JSON.stringify({ cleared: true })
      );
    }

    if (
      currentVersion.localeCompare(latestVersion, undefined, {
        numeric: true,
      }) < 0
    ) {
      this.verbose(1, `A new version of ${repo} is available. Updating...`);

      const updatedCodeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${latestVersion}/squad-server/plugins/my-squad-stats.js`;

      // Download the updated code
      let updatedCode;
      try {
        const response = await axios.get(updatedCodeUrl);
        updatedCode = response.data;
      } catch (error) {
        this.verbose(1, `Error downloading the updated code:`, error);
        return;
      }

      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const filePath = path.join(__dirname, "my-squad-stats.js");
      fs.writeFileSync(filePath, updatedCode);

      // Set the update-cleared.json file to false
      fs.writeFileSync(
        updateClearedFilePath,
        JSON.stringify({ cleared: false })
      );

      this.verbose(
        1,
        `Successfully updated ${repo} to version ${latestVersion}`
      );

      try {
        // Your code that might throw an error
        throw new Error(
          `A new version of ${repo} is available. Please restart the server to apply the update.`
        );
      } catch (error) {
        console.error(error);
        process.exit(1); // Exit the process with a "failure" code
      }
    } else if (currentVersion > latestVersion) {
      this.verbose(
        1,
        `You are running a newer version of ${repo} than the latest version.\nThis likely means you are running a pre-release version.\nYour Current Version: ${currentVersion} Latest Version: ${latestVersion}\nhttps://github.com/${owner}/${repo}/releases`
      );
    } else if (currentVersion === latestVersion) {
      this.verbose(1, `You are running the latest version of ${repo}.`);
    } else {
      this.verbose(1, `Unable to check for updates in ${repo}.`);
    }
    return;
  }

  async pingMySquadStats() {
    this.verbose(1, "Pinging My Squad Stats...");
    if (this.isProcessingFailedRequests) {
      this.verbose(1, "Already processing failed requests...");
      return;
    }
    this.isProcessingFailedRequests = true;

    const __dirname = fileURLToPath(import.meta.url);
    const dataType = "ping";
    const response = await getDataFromAPI(dataType, this.options.accessToken);
    if (response.successMessage === "pong") {
      this.verbose(1, "Pong! My Squad Stats is up and running.");

      const postFilePath = path.join(
        __dirname,
        "..",
        "..",
        "MySquadStats_Data",
        "send-retry-requests.json"
      );
      if (fs.existsSync(postFilePath)) {
        this.verbose(1, `Retrying failed requests from ${postFilePath}...`);
        const completed = await retryFailedRequests(
          postFilePath,
          retryPostDataToAPI,
          this.options.accessToken
        );
        this.verbose(1, completed);
      }

      const patchFilePath = path.join(
        __dirname,
        "..",
        "..",
        "MySquadStats_Data",
        "patch-retry-requests.json"
      );
      if (fs.existsSync(patchFilePath)) {
        this.verbose(1, `Retrying failed requests from ${patchFilePath}...`);
        const completed = await retryFailedRequests(
          patchFilePath,
          retryPatchDataInAPI,
          this.options.accessToken
        );
        this.verbose(1, completed);
      }
    }
    this.isProcessingFailedRequests = false;
    return;
  }

  async getAdmins() {
    this.verbose(1, "Getting Admins...");
    const adminLists = this.server.options.adminLists;
    const groups = {};
    const admins = {};
    const __dirname = fileURLToPath(import.meta.url);

    for (const [idx, list] of adminLists.entries()) {
      let data = "";
      try {
        switch (list.type) {
          case "remote": {
            const resp = await axios({
              method: "GET",
              url: `${list.source}`,
            });
            data = resp.data;
            break;
          }
          case "local": {
            const listPath = path.resolve(__dirname, "../../../", list.source);
            if (!fs.existsSync(listPath))
              throw new Error(`Could not find Admin List at ${listPath}`);
            data = fs.readFileSync(listPath, "utf8");
            break;
          }
          default:
            throw new Error(`Unsupported AdminList type:${list.type}`);
        }
      } catch (error) {
        this.verbose(
          1,
          `Error fetching ${list.type} admin list: ${list.source}`,
          error
        );
      }

      const groupRgx =
        /(?<=^Group=)(?<groupID>.*?):(?<groupPerms>.*?)(?=(?:\r\n|\r|\n|\s+\/\/))/gm;
      const adminRgx =
        /(?<=^Admin=)(?<adminID>\d{17}|[a-f0-9]{32}):(?<groupID>\S+)(?:.*@(?<discordUsername>\S*))?/gm;

      for (const m of data.matchAll(groupRgx)) {
        groups[`${idx}-${m.groups.groupID}`] = m.groups.groupPerms
          .split(",")
          .map((perm) => perm.trim());
      }
      for (const m of data.matchAll(adminRgx)) {
        try {
          const group = groups[`${idx}-${m.groups.groupID}`];
          const perms = {};
          for (const groupPerm of group) perms[groupPerm.toLowerCase()] = true;

          const adminID = m.groups.adminID;
          const discordUsername = m.groups.discordUsername || null;

          if (adminID in admins) {
            admins[adminID] = Object.assign(admins[adminID], perms, {
              discordUsername,
            });
            this.verbose(
              3,
              `Merged duplicate Admin ${adminID} to ${Object.keys(
                admins[adminID]
              )}`
            );
          } else {
            admins[adminID] = Object.assign(perms, { discordUsername });
            this.verbose(
              3,
              `Added Admin ${adminID} with ${Object.keys(perms)}`
            );
          }
        } catch (error) {
          this.verbose(
            1,
            `Error parsing admin group ${m.groups.groupID} from admin list: ${list.source}`,
            error
          );
        }
      }
    }
    this.verbose(1, `${Object.keys(admins).length} admins loaded...`);

    let existingAdmins = {};
    const adminFilePath = path.join(
      __dirname,
      "..",
      "..",
      "MySquadStats_Data",
      "admins.json"
    );

    for (let adminId in admins) {
      let admin = admins[adminId];

      // Check if the admin is already in the local json file
      // If they are, check if they have the same permissions
      // If the permissions are different, proceed, otherwise continue

      // Read the existing admins from the admins.json file
      if (fs.existsSync(adminFilePath)) {
        existingAdmins = JSON.parse(fs.readFileSync(adminFilePath));
      }

      let adminData = {};
      if (fs.existsSync(adminFilePath)) {
        adminData = JSON.parse(fs.readFileSync(adminFilePath));
      }
      if (adminId in adminData) {
        const localAdmin = adminData[adminId];
        if (JSON.stringify(localAdmin) !== JSON.stringify(admin)) {
          // If the permissions are different, update the local json file
          adminData[adminId] = admin;
          fs.writeFileSync(adminFilePath, JSON.stringify(adminData));
          this.verbose(
            2,
            `Updated Admin ${adminId} in local json file with new permissions`
          );
        } else {
          this.verbose(
            2,
            `Admin ${adminId} is already in local json file with the same permissions`
          );
          continue;
        }
      }

      let playerData = {};
      // Check if the admin is a steamID or an EOS ID
      if (adminId.length === 17) {
        playerData = {
          steamID: adminId,
        };
      } else {
        playerData = {
          eosID: adminId,
        };
      }

      // Add the permissions to the playerData
      if (admin.canseeadminchat) {
        playerData = {
          ...playerData,
          isAdmin: 1,
        };
      } else {
        playerData = {
          ...playerData,
          isAdmin: 0,
        };
      }
      if (admin.reserve) {
        playerData = {
          ...playerData,
          isReserve: 1,
        };
      } else {
        playerData = {
          ...playerData,
          isReserve: 0,
        };
      }

      // Add the discordUsername to the playerData if it exists
      if (admin.discordUsername !== null) {
        playerData = {
          ...playerData,
          discordUsername: admin.discordUsername,
        };
      }

      const dataType = "players";
      const response = await patchDataInAPI(
        dataType,
        playerData,
        this.options.accessToken
      );
      // Only log the response if it's an error
      if (response.successStatus === "Error") {
        this.verbose(
          1,
          `GetAdmins-Player | ${response.successStatus} | ${response.successMessage}`
        );
        continue;
      }

      // Store admin in local json file
      adminData[adminId] = admin;

      const adminDirPath = path.dirname(adminFilePath);

      // Create the directory if it doesn't exist
      if (!fs.existsSync(adminDirPath)) {
        fs.mkdirSync(adminDirPath, { recursive: true });
      }

      fs.writeFileSync(adminFilePath, JSON.stringify(adminData));

      // Add a delay before processing the next admin
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // After processing all the new admins, check for removed admins
    for (let adminId in existingAdmins) {
      if (!(adminId in admins)) {
        let playerData = {};
        // Check if the admin is a steamID or an EOS ID
        if (adminId.length === 17) {
          playerData = {
            steamID: adminId,
          };
        } else {
          playerData = {
            eosID: adminId,
          };
        }

        // Add removeWhitelist to the playerData
        playerData = {
          ...playerData,
          removeAdmin: 1,
        };

        // Make API request to remove the admin
        const dataType = "players";
        const response = await patchDataInAPI(
          dataType,
          playerData,
          this.options.accessToken
        );
        // Only log the response if it's an error
        if (response.successStatus === "Error") {
          this.verbose(
            1,
            `GetAdmins-Remove | ${response.successStatus} | ${response.successMessage}`
          );
        }

        // This admin was removed
        this.verbose(1, `Admin ${adminId} was removed`);

        // Remove the admin from the existingAdmins object
        delete existingAdmins[adminId];
      }
    }

    // Write the updated existingAdmins object back to the admins.json file
    fs.writeFileSync(adminFilePath, JSON.stringify(existingAdmins));
    return;
  }

  async onChatCommand(info) {
    // Get the message
    const message = info.message;

    // Help Commands
    if (
      message === "help" ||
      message === "commands" ||
      message === "cmds" ||
      message === "h" ||
      message.length === 0
    ) {
      await this.server.rcon.warn(
        info.player.steamID,
        `Commands:\n!mss link - Link to MySquadStats.com\n!mss stats - Check your stats`
      );
      return;
    }

    if (message === "link") {
      // !mss link 123456
      // Get the 6 digit number from the message
      const linkCode = message.split(" ")[2];
      // Check if linkCode is not the right length
      if (linkCode !== 6) {
        await this.server.rcon.warn(
          info.player.steamID,
          `Please input a valid 6-digit Link Code.\nExample: !mss link 123456`
        );
        return;
      }
      // Get Player from API
      let dataType = `players?search=${info.player.steamID}`;
      let response = await getDataFromAPI(dataType, this.options.accessToken);
      if (response.successStatus === "Error") {
        await this.server.rcon.warn(
          info.player.steamID,
          `An error occurred while trying to link your account.\nPlease try again later.`
        );
        return;
      }
      const player = response.data[0];
      // If discordID is already linked, return error
      if (player.discordID !== "Unknown") {
        await this.server.rcon.warn(
          info.player.steamID,
          `Your account is already linked.\nContact an MySquadStats.com if this is wrong.`
        );
        return;
      }

      // Post Request to link Player in API
      dataType = "playerLink";
      const linkData = {
        steamID: info.player.steamID,
        code: linkCode,
      };
      response = await postDataToAPI(
        dataType,
        linkData,
        this.options.accessToken
      );
      if (response.successStatus === "Error") {
        await this.server.rcon.warn(
          info.player.steamID,
          `${response.successMessage}\nPlease try again later.`
        );
        return;
      }

      await this.server.rcon.warn(
        info.player.steamID,
        `Thank you for linking your accounts.`
      );
    } else if (message === "stats") {
      if (this.options.allowInGameStatsCommand === false) {
        return this.server.rcon.warn(
          info.player.steamID,
          `This Server has disabled the in-game stats command.\nCheck your stats at MySquadStats.com`
        );
      }
      await this.server.rcon.warn(
        info.player.steamID,
        `WIP.\nCheck your stats at MySquadStats.com`
      );
    }
    return;
  }

  async onRoundEnded(info) {
    const dataType = "matches";
    let matchData = {};
    if (!info.winner || !info.loser) {
      matchData = {
        endTime: info.time,
        winningTeam: "Draw",
        winningSubfaction: "Draw",
        winningTickets: 0,
        losingTeam: "Draw",
        losingSubfaction: "Draw",
        losingTickets: 0,
      };
    } else {
      matchData = {
        endTime: info.time,
        winningTeam: info.winner.faction,
        winningSubfaction: info.winner.subfaction,
        winningTickets: info.winner.tickets,
        losingTeam: info.loser.faction,
        losingSubfaction: info.loser.subfaction,
        losingTickets: info.loser.tickets,
      };

      const response = await patchDataInAPI(
        dataType,
        matchData,
        this.options.accessToken
      );
      if (response.successStatus === "Error") {
        this.verbose(
          1,
          `RoundEnded-Match | ${response.successStatus} | ${response.successMessage}`
        );
      }
    }
    return;
  }

  async onNewGame(info) {
    // Post Request to create Server in API
    let dataType = "servers";
    const serverData = {
      name: this.server.serverName,
      version: currentVersion,
    };
    const serverResponse = await postDataToAPI(
      dataType,
      serverData,
      this.options.accessToken
    );
    this.verbose(
      1,
      `NewGame-Server | ${serverResponse.successStatus} | ${serverResponse.successMessage}`
    );

    // Post Request to create new Match in API
    dataType = "matches";
    const newMatchData = {
      server: this.server.serverName,
      dlc: info.dlc,
      mapClassname: info.mapClassname,
      layerClassname: info.layerClassname,
      map: info.layer ? info.layer.map.name : null,
      layer: info.layer ? info.layer.name : null,
      startTime: info.time,
    };
    const matchResponse = await postDataToAPI(
      dataType,
      newMatchData,
      this.options.accessToken
    );
    this.match = matchResponse.match;
    if (matchResponse.successStatus === "Error") {
      this.verbose(
        1,
        `NewGame-Post-Match${matchResponse.successStatus} | ${matchResponse.successMessage}`
      );
    }
    return;
  }

  async onPlayerWounded(info) {
    // Post Request to create Wound in API
    const dataType = "wounds";
    const woundData = {
      match: this.match ? this.match.id : null,
      time: info.time,
      victim: info.victim ? info.victim.steamID : null,
      victimEosID: info.victim ? info.victim.eosID : null,
      victimName: info.victim ? info.victim.name : null,
      victimTeamID: info.victim ? info.victim.teamID : null,
      victimSquadID: info.victim ? info.victim.squadID : null,
      attacker: info.attacker ? info.attacker.steamID : null,
      attackerEosID: info.attacker ? info.attacker.eosID : null,
      attackerName: info.attacker ? info.attacker.name : null,
      attackerTeamID: info.attacker ? info.attacker.teamID : null,
      attackerSquadID: info.attacker ? info.attacker.squadID : null,
      damage: info.damage,
      weapon: info.weapon,
      teamkill: info.teamkill,
    };
    const response = await postDataToAPI(
      dataType,
      woundData,
      this.options.accessToken
    );
    if (response.successStatus === "Error") {
      this.verbose(
        1,
        `Wounds-Wound | ${response.successStatus} | ${response.successMessage}`
      );
    }
    return;
  }

  async onPlayerDied(info) {
    // Killstreaks
    if (info.victim) {
      // Post Request to create Death in API
      const dataType = "deaths";
      const deathData = {
        match: this.match ? this.match.id : null,
        time: info.time,
        woundTime: info.woundTime,
        victim: info.victim ? info.victim.steamID : null,
        victimEosID: info.victim ? info.victim.eosID : null,
        victimName: info.victim ? info.victim.name : null,
        victimTeamID: info.victim ? info.victim.teamID : null,
        victimSquadID: info.victim ? info.victim.squadID : null,
        attacker: info.attacker ? info.attacker.steamID : null,
        attackerEosID: info.attacker ? info.attacker.eosID : null,
        attackerName: info.attacker ? info.attacker.name : null,
        attackerTeamID: info.attacker ? info.attacker.teamID : null,
        attackerSquadID: info.attacker ? info.attacker.squadID : null,
        damage: info.damage,
        weapon: info.weapon,
        teamkill: info.teamkill,
      };
      const response = await postDataToAPI(
        dataType,
        deathData,
        this.options.accessToken
      );
      if (response.successStatus === "Error") {
        this.verbose(
          1,
          `Died-Death | ${response.successStatus} | ${response.successMessage}`
        );
      }
    }
    return;
  }

  async onPlayerRevived(info) {
    // Post Request to create Revive in API
    const dataType = "revives";
    const reviveData = {
      match: this.match ? this.match.id : null,
      time: info.time,
      woundTime: info.woundTime,
      victim: info.victim ? info.victim.steamID : null,
      victimEosID: info.victim ? info.victim.eosID : null,
      victimName: info.victim ? info.victim.name : null,
      victimTeamID: info.victim ? info.victim.teamID : null,
      victimSquadID: info.victim ? info.victim.squadID : null,
      attacker: info.attacker ? info.attacker.steamID : null,
      attackerEosID: info.attacker ? info.attacker.eosID : null,
      attackerName: info.attacker ? info.attacker.name : null,
      attackerTeamID: info.attacker ? info.attacker.teamID : null,
      attackerSquadID: info.attacker ? info.attacker.squadID : null,
      damage: info.damage,
      weapon: info.weapon,
      teamkill: info.teamkill,
      reviver: info.reviver ? info.reviver.steamID : null,
      reviverEosID: info.reviver ? info.reviver.eosID : null,
      reviverName: info.reviver ? info.reviver.name : null,
      reviverTeamID: info.reviver ? info.reviver.teamID : null,
      reviverSquadID: info.reviver ? info.reviver.squadID : null,
    };
    const response = await postDataToAPI(
      dataType,
      reviveData,
      this.options.accessToken
    );
    if (response.successStatus === "Error") {
      this.verbose(
        1,
        `Revives-Revive | ${response.successStatus} | ${response.successMessage}`
      );
    }
    return;
  }

  async onPlayerConnected(info) {
    let playerData = {};
    if (
      this.server.a2sPlayerCount <= 50 &&
      this.server.currentLayer &&
      this.server.currentLayer.gamemode === "Seed"
    ) {
      playerData = {
        isSeeder: 1,
      };
    }

    // Patch Request to create Player in API
    const dataType = "players";
    playerData = {
      ...playerData,
      eosID: info.eosID,
      steamID: info.player.steamID,
      lastName: info.player.name,
      lastIP: info.ip,
    };
    const response = await patchDataInAPI(
      dataType,
      playerData,
      this.options.accessToken
    );
    if (response.successStatus === "Error") {
      this.verbose(
        1,
        `Connected-Player | ${response.successStatus} | ${response.successMessage}`
      );
    }
    return;
  }

  // KILLSTREAKS
  async killstreakWounded(info) {
    if (!info.attacker) return;
    if (info.teamkill === true) return;

    // Get the attacker's Steam ID
    const eosID = info.attacker.eosID;

    // Check if this is the first time the attacker has made a killstreak
    if (!this.trackedKillstreaks.hasOwnProperty(eosID)) {
      // Set the player's initial killstreak to 0
      this.trackedKillstreaks[eosID] = 0;
    }

    // Increment the player's kill streak by 1
    this.trackedKillstreaks[eosID] += 1;
  }

  async killstreakDied(info) {
    if (!info.victim) return;
    // GC Driod Support
    // Geonosian Hive
    const gcDroidFactions = [
      "Droid Army",
      "Droid Army - Lego",
      "Droid Army - SpecOps",
      "Droid Army - Camo",
      "Droid Army - Snow",
      "Droid Army - Mech",
      "Droid Army - Halloween",
      "Droid Army - Geonosis",
    ];
    // If info.victim.squad.teamName is in gcDroidFactions
    if (gcDroidFactions.includes(info?.victim?.squad?.teamName)) {
      this.verbose(2, `Droid Army Detected: ${info.victim.squad.teamName}`);
      // Call the onWound function with the info object
      this.killstreakWounded(info);
    }
    const eosID = info.victim.eosID;
    // Update highestKillstreak in the SQL database and get the new highestKillstreak
    await this.updateHighestKillstreak(eosID);

    if (this.trackedKillstreaks.hasOwnProperty(eosID)) {
      delete this.trackedKillstreaks[eosID];
    }
  }

  async killstreakNewGame(info) {
    // Get an array of all the Steam IDs in the trackedKillstreaks object
    const eosIDs = Object.keys(this.trackedKillstreaks);

    // Loop through the array
    for (const eosID of eosIDs) {
      if (this.trackedKillstreaks[eosID] > 0) {
        // Update highestKillstreak in the SQL database
        await this.updateHighestKillstreak(eosID);
      }

      // Remove the player from the trackedKillstreaks object
      delete this.trackedKillstreaks[eosID];
    }
    return;
  }

  async killstreakDisconnected(info) {
    if (!info.eosID) return;
    const eosID = info.eosID;

    // Update highestKillstreak in the SQL database
    if (this.trackedKillstreaks.hasOwnProperty(eosID)) {
      if (this.trackedKillstreaks[eosID] > 0) {
        await this.updateHighestKillstreak(eosID);
      }
    }

    delete this.trackedKillstreaks[eosID];
  }

  async updateHighestKillstreak(eosID) {
    // Get the player's current killstreak from the trackedKillstreaks object
    const currentKillstreak = this.trackedKillstreaks[eosID];

    // Return is the player's current killstreak is 0
    if (!currentKillstreak || currentKillstreak === 0) return;

    try {
      // Patch Request to update highestKillstreak in API
      const dataType = "playerKillstreaks";
      const playerData = {
        eosID: eosID,
        highestKillstreak: currentKillstreak,
        match: this.match ? this.match.id : null,
      };
      const response = await patchDataInAPI(
        dataType,
        playerData,
        this.options.accessToken
      );
      if (response.successStatus === "Error") {
        this.verbose(
          1,
          `Error updating highestKillstreak in database for ${eosID}: ${response.successMessage}`
        );
      }
    } catch (error) {
      this.verbose(
        1,
        `Error updating highestKillstreak in database for ${eosID}: ${error}`
      );
    }
    return;
  }
}

// Retrieve the latest version from GitHub
async function getLatestVersion(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const response = await fetch(url);
  const data = await response.json();
  return data.tag_name;
}

function handleApiError(error) {
  if (error.response) {
    let errMsg = `${error.response.status} - ${error.response.statusText}`;
    const status = "Error";
    if (error.response.status === 502) {
      errMsg += " Unable to connect to the API. My Squad Stats is likely down.";
    } else if (error.response.status === 500) {
      errMsg += " Internal server error. Something went wrong on the server.";
    }
    return {
      successStatus: status,
      successMessage: errMsg,
    };
  } else if (error.request) {
    // The request was made but no response was received
    return {
      successStatus: "Error",
      successMessage:
        "No response received from the API. Please check your network connection.",
    };
  } else {
    // Something happened in setting up the request that triggered an Error
    return {
      successStatus: "Error",
      successMessage: `Error: ${error.message}`,
    };
  }
}

async function retryFailedRequests(filePath, apiFunction, accessToken) {
  let failedRequests = JSON.parse(fs.readFileSync(filePath));

  // Send Ping to My Squad Stats with amount of failed requests
  const pingDataType = "ping";
  const pingData = {
    filePath: filePath,
    failedRequests: failedRequests.length,
  };
  const pingResponse = await postDataToAPI(pingDataType, pingData, accessToken);
  console.log(
    `Ping-MySquadStats | ${pingResponse.successStatus} | ${pingResponse.successMessage}`
  );

  // Sort the array so that match requests come first
  failedRequests.sort((a, b) => {
    if (a.dataType === "matches" && b.dataType !== "matches") {
      return -1;
    } else if (a.dataType !== "matches" && b.dataType === "matches") {
      return 1;
    } else {
      return 0;
    }
  });

  for (let i = 0; i < failedRequests.length; i++) {
    const request = failedRequests[i];
    const retryResponse = await apiFunction(
      request.dataType,
      request.data,
      accessToken
    );
    console.log(
      `${retryResponse.successStatus} | ${retryResponse.successMessage}`
    );
    if (retryResponse.successStatus === "Success") {
      // Remove the request from the array
      failedRequests.splice(i, 1);
      // Decrement i so the next iteration won't skip an item
      i--;
      // Write the updated failedRequests array back to the file
      fs.writeFileSync(filePath, JSON.stringify(failedRequests));
    }
    // Wait for 5 seconds before processing the next request
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Delete the file if there are no more failed requests
  if (failedRequests.length === 0) {
    fs.unlinkSync(filePath);
  }

  let completed = `Finished retrying failed requests from ${filePath}.`;
  return completed;
}

async function postDataToAPI(dataType, data, accessToken) {
  const __dirname = fileURLToPath(import.meta.url);
  try {
    const response = await axios.post(
      `https://mysquadstats.com/api/${dataType}`,
      data,
      {
        params: { accessToken },
      }
    );
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 502) {
      // Save the request details to a local file for later retry
      const requestDetails = {
        dataType: `${dataType}`,
        data: data,
      };
      const dirPath = path.join(__dirname, "..", "..", "MySquadStats_Data");
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const filePath = path.join(dirPath, "send-retry-requests.json");
      let failedRequests = [];
      if (fs.existsSync(filePath)) {
        failedRequests = JSON.parse(fs.readFileSync(filePath));
      }
      failedRequests.push(requestDetails);
      fs.writeFileSync(filePath, JSON.stringify(failedRequests));
    }
    return handleApiError(error);
  }
}

async function patchDataInAPI(dataType, data, accessToken) {
  const __dirname = fileURLToPath(import.meta.url);
  try {
    const response = await axios.patch(
      `https://mysquadstats.com/api/${dataType}`,
      data,
      {
        params: { accessToken },
      }
    );
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 502) {
      // Save the request details to a local file for later retry
      const requestDetails = {
        dataType: `${dataType}`,
        data: data,
      };
      const dirPath = path.join(__dirname, "..", "..", "MySquadStats_Data");
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const filePath = path.join(dirPath, "patch-retry-requests.json");
      let failedRequests = [];
      if (fs.existsSync(filePath)) {
        failedRequests = JSON.parse(fs.readFileSync(filePath));
      }
      failedRequests.push(requestDetails);
      fs.writeFileSync(filePath, JSON.stringify(failedRequests));
    }
    return handleApiError(error);
  }
}

async function getDataFromAPI(dataType, accessToken) {
  try {
    const response = await axios.get(
      `https://mysquadstats.com/api/${dataType}`,
      {
        params: { accessToken },
      }
    );
    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
}

async function retryPostDataToAPI(dataType, data, accessToken) {
  try {
    const response = await axios.post(
      `https://mysquadstats.com/api/${dataType}`,
      data,
      {
        params: { accessToken },
      }
    );
    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
}

async function retryPatchDataInAPI(dataType, data, accessToken) {
  try {
    const response = await axios.patch(
      `https://mysquadstats.com/api/${dataType}`,
      data,
      {
        params: { accessToken },
      }
    );
    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
}
