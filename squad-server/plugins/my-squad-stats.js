import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';

import BasePlugin from './base-plugin.js';

const currentVersion = 'v2.0.1';

export default class MySquadStats extends BasePlugin {
  static get description() {
    return (
      'The <code>gMySquadStats/code> plugin will log various server statistics and events to a central database for player stat tracking.'
    );
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      accessToken: {
        required: true,
        description: 'The access token to use for the database.',
        default: "YOUR_ACCESS_TOKEN"
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.onNewGame = this.onNewGame.bind(this);
    this.onPlayerConnected = this.onPlayerConnected.bind(this);
    this.onPlayerWounded = this.onPlayerWounded.bind(this);
    this.onPlayerDied = this.onPlayerDied.bind(this);
    this.onPlayerRevived = this.onPlayerRevived.bind(this);
    this.isProcessingFailedRequests = false;
  }

  async prepareToMount() {

  }

  async mount() {
    // Post Request to create Server in API
    let dataType = 'servers';
    let serverData = {
      name: this.server.serverName,
      version: currentVersion
    };
    let response = await sendDataToAPI(dataType, serverData, this.options.accessToken);
    this.verbose(1, `${response.successStatus} | ${response.successMessage}`);

    // Get Request to get Match Info from API
    dataType = 'matches';
    let matchResponse = await getDataFromAPI(dataType, this.options.accessToken);
    this.match = matchResponse.match;
    this.verbose(1, `${matchResponse.successStatus} | ${matchResponse.successMessage}`);

    this.server.on('NEW_GAME', this.onNewGame);
    this.server.on('PLAYER_CONNECTED', this.onPlayerConnected);
    this.server.on('PLAYER_WOUNDED', this.onPlayerWounded);
    this.server.on('PLAYER_DIED', this.onPlayerDied);
    this.server.on('PLAYER_REVIVED', this.onPlayerRevived);
    this.checkVersion();
    this.interval = setInterval(
      this.pingMySquadStats.bind(this),
      60000
    );
  }

  async unmount() {
    this.server.removeEventListener('NEW_GAME', this.onNewGame);
    this.server.removeEventListener('PLAYER_CONNECTED', this.onPlayerConnected);
    this.server.removeEventListener('PLAYER_WOUNDED', this.onPlayerWounded);
    this.server.removeEventListener('PLAYER_DIED', this.onPlayerDied);
    this.server.removeEventListener('PLAYER_REVIVED', this.onPlayerRevived);
    clearInterval(this.interval);
  }

  // Check if current version is the latest version
  async checkVersion() {
    const owner = 'IgnisAlienus';
    const repo = 'SquadJS-My-Squad-Stats';

    try {
      const latestVersion = await getLatestVersion(owner, repo);

      if (currentVersion < latestVersion) {
        this.verbose(1, `A new version of ${repo} is available. Updating...`);

        // Update code provided by Zer0-1ne - Thank you!
        const updatedCodeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${latestVersion}/squad-server/plugins/my-squad-stats.js`;
        const updatedCodeResponse = await axios.get(updatedCodeUrl);

        // Replace the existing code file with the updated code
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const filePath = path.join(__dirname, 'my-squad-stats.js');
        fs.writeFileSync(filePath, updatedCodeResponse.data);

        this.verbose(1, `Successfully updated ${repo} to version ${latestVersion}`);
      } else if (currentVersion > latestVersion) {
        this.verbose(1, `You are running a newer version of ${repo} than the latest version.\nThis likely means you are running a pre-release version.\nCurrent version: ${currentVersion} Latest Version: ${latestVersion}\nhttps://github.com/${owner}/${repo}/releases`);
      } else if (currentVersion === latestVersion) {
        this.verbose(1, `You are running the latest version of ${repo}.`);
      } else {
        this.verbose(1, `Unable to check for updates in ${repo}.`);
      }
    } catch (error) {
      this.verbose(1, `Error retrieving the latest version off ${repo}:`, error);
    }
  }

  async pingMySquadStats() {
    if (this.isProcessingFailedRequests) {
      this.verbose(1, 'Already processing failed requests...');
      return;
    }
    this.isProcessingFailedRequests = true;

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    let dataType = 'ping';
    let response = await getDataFromAPI(dataType, this.options.accessToken);
    if (response.successMessage === 'pong') {
      // Check for any failed requests and retry
      const filePath = path.join(__dirname, 'send-retry-requests.json');
      if (fs.existsSync(filePath)) {
        this.verbose(1, 'Retrying failed POST requests...');
        let failedRequests = JSON.parse(fs.readFileSync(filePath));
        for (let i = 0; i < failedRequests.length; i++) {
          let request = failedRequests[i];
          let retryResponse = await sendDataToAPI(request.dataType, request.data, this.options.accessToken);
          this.verbose(1, `${retryResponse.successStatus} | ${retryResponse.successMessage}`);
          if (retryResponse.successStatus === 'Success') {
            // Remove the request from the array
            failedRequests.splice(i, 1);
            // Decrement i so the next iteration won't skip an item
            i--;
            // Write the updated failedRequests array back to the file
            fs.writeFileSync(filePath, JSON.stringify(failedRequests));
          }
          // Wait for 5 seconds before processing the next request
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        // Delete the file if there are no more failed requests
        if (failedRequests.length === 0) {
          fs.unlinkSync(filePath);
        }
        this.verbose(1, 'Finished retrying failed POST requests.');
      }
      const patchFilePath = path.join(__dirname, 'patch-retry-requests.json');
      if (fs.existsSync(patchFilePath)) {
        this.verbose(1, 'Retrying failed PATCH requests...');
        let failedRequests = JSON.parse(fs.readFileSync(patchFilePath));
        for (let i = 0; i < failedRequests.length; i++) {
          let request = failedRequests[i];
          let retryResponse = await patchDataInAPI(request.dataType, request.data, this.options.accessToken);
          this.verbose(1, `${retryResponse.successStatus} | ${retryResponse.successMessage}`);
          if (retryResponse.successStatus === 'Success') {
            // Remove the request from the array
            failedRequests.splice(i, 1);
            // Decrement i so the next iteration won't skip an item
            i--;
            // Write the updated failedRequests array back to the file
            fs.writeFileSync(patchFilePath, JSON.stringify(failedRequests));
          }
          // Wait for 5 seconds before processing the next request
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        // Delete the file if there are no more failed requests
        if (failedRequests.length === 0) {
          fs.unlinkSync(patchFilePath);
        }
        this.verbose(1, 'Finished retrying failed PATCH requests.');
      }
    }
    this.isProcessingFailedRequests = false;
  }

  async onNewGame(info) {
    // Post Request to create Server in API
    let dataType = 'servers';
    let serverData = {
      name: this.server.serverName,
      version: currentVersion
    };
    let serverResponse = await sendDataToAPI(dataType, serverData, this.options.accessToken);
    this.verbose(1, `${serverResponse.successStatus} | ${serverResponse.successMessage}`);

    // Patch Request to update last Match in API
    dataType = 'matches';
    let matchData = {
      endTime: info.time,
      winner: info.winner
    };
    let updateResponse = await patchDataInAPI(dataType, matchData, this.options.accessToken);
    if (updateResponse.successStatus === 'Error') {
      this.verbose(1, `${updateResponse.successStatus} | ${updateResponse.successMessage}`);
    }

    // Post Request to create new Match in API
    dataType = 'matches';
    let newMatchData = {
      server: this.server.serverName,
      dlc: info.dlc,
      mapClassname: info.mapClassname,
      layerClassname: info.layerClassname,
      map: info.layer ? info.layer.map.name : null,
      layer: info.layer ? info.layer.name : null,
      startTime: info.time
    };
    let matchResponse = await sendDataToAPI(dataType, newMatchData, this.options.accessToken);
    this.match = matchResponse.match;
    if (matchResponse.successStatus === 'Error') {
      this.verbose(1, `${matchResponse.successStatus} | ${matchResponse.successMessage}`);
    }
  }

  async onPlayerWounded(info) {
    if (info.attacker) {
      // Patch Request to update Player in API
      let dataType = 'players';
      let playerData = {
        eosID: info.attacker.eosID,
        steamID: info.attacker.steamID,
        lastName: info.attacker.name
      };
      let updateResponse = await patchDataInAPI(dataType, playerData, this.options.accessToken);
      if (updateResponse.successStatus === 'Error') {
        this.verbose(1, `${updateResponse.successStatus} | ${updateResponse.successMessage}`);
      }
    }
    if (info.victim) {
      // Patch Request to update Player in API
      let dataType = 'players';
      let playerData = {
        eosID: info.victim.eosID,
        steamID: info.victim.steamID,
        lastName: info.victim.name
      };
      let updateResponse = await patchDataInAPI(dataType, playerData, this.options.accessToken);
      if (updateResponse.successStatus === 'Error') {
        this.verbose(1, `${updateResponse.successStatus} | ${updateResponse.successMessage}`);
      }
    }

    // Post Request to create Wound in API
    let dataType = 'wounds';
    let woundData = {
      match: this.match ? this.match.id : null,
      time: info.time,
      victim: info.victim ? info.victim.steamID : null,
      victimName: info.victim ? info.victim.name : null,
      victimTeamID: info.victim ? info.victim.teamID : null,
      victimSquadID: info.victim ? info.victim.squadID : null,
      attacker: info.attacker ? info.attacker.steamID : null,
      attackerName: info.attacker ? info.attacker.name : null,
      attackerTeamID: info.attacker ? info.attacker.teamID : null,
      attackerSquadID: info.attacker ? info.attacker.squadID : null,
      damage: info.damage,
      weapon: info.weapon,
      teamkill: info.teamkill
    };
    let response = await sendDataToAPI(dataType, woundData, this.options.accessToken);
    if (response.successStatus === 'Error') {
      this.verbose(1, `${response.successStatus} | ${response.successMessage}`);
    }
  }

  async onPlayerDied(info) {
    if (info.attacker) {
      // Patch Request to update Player in API
      let dataType = 'players';
      let playerData = {
        eosID: info.attacker.eosID,
        steamID: info.attacker.steamID,
        lastName: info.attacker.name
      };
      let updateResponse = await patchDataInAPI(dataType, playerData, this.options.accessToken);
      if (updateResponse.successStatus === 'Error') {
        this.verbose(1, `${updateResponse.successStatus} | ${updateResponse.successMessage}`);
      }
    }
    if (info.victim) {
      // Patch Request to update Player in API
      let dataType = 'players';
      let playerData = {
        eosID: info.victim.eosID,
        steamID: info.victim.steamID,
        lastName: info.victim.name
      };
      let updateResponse = await patchDataInAPI(dataType, playerData, this.options.accessToken);
      if (updateResponse.successStatus === 'Error') {
        this.verbose(1, `${updateResponse.successStatus} | ${updateResponse.successMessage}`);
      }
    }

    // Post Request to create Death in API
    let dataType = 'deaths';
    let deathData = {
      match: this.match ? this.match.id : null,
      time: info.time,
      woundTime: info.woundTime,
      victim: info.victim ? info.victim.steamID : null,
      victimName: info.victim ? info.victim.name : null,
      victimTeamID: info.victim ? info.victim.teamID : null,
      victimSquadID: info.victim ? info.victim.squadID : null,
      attacker: info.attacker ? info.attacker.steamID : null,
      attackerName: info.attacker ? info.attacker.name : null,
      attackerTeamID: info.attacker ? info.attacker.teamID : null,
      attackerSquadID: info.attacker ? info.attacker.squadID : null,
      damage: info.damage,
      weapon: info.weapon,
      teamkill: info.teamkill
    };
    let response = await sendDataToAPI(dataType, deathData, this.options.accessToken);
    if (response.successStatus === 'Error') {
      this.verbose(1, `${response.successStatus} | ${response.successMessage}`);
    }
  }

  async onPlayerRevived(info) {
    if (info.attacker) {
      // Patch Request to update Player in API
      let dataType = 'players';
      let playerData = {
        eosID: info.attacker.eosID,
        steamID: info.attacker.steamID,
        lastName: info.attacker.name
      };
      let updateResponse = await patchDataInAPI(dataType, playerData, this.options.accessToken);
      if (updateResponse.successStatus === 'Error') {
        this.verbose(1, `${updateResponse.successStatus} | ${updateResponse.successMessage}`);
      }
    }
    if (info.victim) {
      // Patch Request to update Player in API
      let dataType = 'players';
      let playerData = {
        eosID: info.victim.eosID,
        steamID: info.victim.steamID,
        lastName: info.victim.name
      };
      let updateResponse = await patchDataInAPI(dataType, playerData, this.options.accessToken);
      if (updateResponse.successStatus === 'Error') {
        this.verbose(1, `${updateResponse.successStatus} | ${updateResponse.successMessage}`);
      }
    }
    if (info.reviver) {
      // Patch Request to update Player in API
      let dataType = 'players';
      let playerData = {
        eosID: info.reviver.eosID,
        steamID: info.reviver.steamID,
        lastName: info.reviver.name
      };
      let updateResponse = await patchDataInAPI(dataType, playerData, this.options.accessToken);
      if (updateResponse.successStatus === 'Error') {
        this.verbose(1, `${updateResponse.successStatus} | ${updateResponse.successMessage}`);
      }
    }

    // Post Request to create Revive in API
    let dataType = 'revives';
    let reviveData = {
      match: this.match ? this.match.id : null,
      time: info.time,
      woundTime: info.woundTime,
      victim: info.victim ? info.victim.steamID : null,
      victimName: info.victim ? info.victim.name : null,
      victimTeamID: info.victim ? info.victim.teamID : null,
      victimSquadID: info.victim ? info.victim.squadID : null,
      attacker: info.attacker ? info.attacker.steamID : null,
      attackerName: info.attacker ? info.attacker.name : null,
      attackerTeamID: info.attacker ? info.attacker.teamID : null,
      attackerSquadID: info.attacker ? info.attacker.squadID : null,
      damage: info.damage,
      weapon: info.weapon,
      teamkill: info.teamkill,
      reviver: info.reviver ? info.reviver.steamID : null,
      reviverName: info.reviver ? info.reviver.name : null,
      reviverTeamID: info.reviver ? info.reviver.teamID : null,
      reviverSquadID: info.reviver ? info.reviver.squadID : null
    };
    let response = await sendDataToAPI(dataType, reviveData, this.options.accessToken);
    if (response.successStatus === 'Error') {
      this.verbose(1, `${response.successStatus} | ${response.successMessage}`);
    }
  }

  async onPlayerConnected(info) {
    // Patch Request to create Player in API
    let dataType = 'players';
    let playerData = {
      eosID: info.eosID,
      steamID: info.player.steamID,
      lastName: info.player.name,
      lastIP: info.ip
    };
    let response = await patchDataInAPI(dataType, playerData, this.options.accessToken);
    if (response.successStatus === 'Error') {
      this.verbose(1, `${response.successStatus} | ${response.successMessage}`);
    }
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
    let status = 'Error';
    if (error.response.status === 502) {
      errMsg += ' | Unable to connect to the API. My Squad Stats is likely down.';
    }
    return {
      successStatus: status,
      successMessage: errMsg
    };
  } else if (error.request) {
    // The request was made but no response was received
    return {
      successStatus: 'Error',
      successMessage: 'No response received from the API. Please check your network connection.'
    };
  } else {
    // Something happened in setting up the request that triggered an Error
    return {
      successStatus: 'Error',
      successMessage: `Error: ${error.message}`
    };
  }
}

async function sendDataToAPI(dataType, data, accessToken) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  try {
    const response = await axios.post(`https://mysquadstats.com/api/${dataType}`, data, { params: { accessToken } });
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 502) {
      // Save the request details to a local file for later retry
      const requestDetails = {
        url: `https://mysquadstats.com/api/${dataType}`,
        data: data,
        params: { accessToken: accessToken }
      };
      const filePath = path.join(__dirname, 'send-retry-requests.json');
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
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  try {
    const response = await axios.patch(`https://mysquadstats.com/api/${dataType}`, data, { params: { accessToken } });
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 502) {
      // Save the request details to a local file for later retry
      const requestDetails = {
        dataType: `${dataType}`,
        data: data
      };
      const filePath = path.join(__dirname, 'patch-retry-requests.json');
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
    const response = await axios.get(`https://mysquadstats.com/api/${dataType}`, { params: { accessToken } });
    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
}