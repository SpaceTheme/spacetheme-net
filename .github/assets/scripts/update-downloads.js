const fs = require('fs');
const axios = require('axios');
const path = '.github/assets/data/downloads.json';

async function getValueFromApi(apiUrl, dataPath) {
    if (!apiUrl) return 0;
    try {
        const res = await axios.get(apiUrl, { timeout: 10000 });
        let value = res.data;
        // data_path kann verschachtelt sein, z.B. "foo.bar"
        return parseInt(dataPath.split('.').reduce((obj, key) => obj && obj[key], value)) || 0;
    } catch (e) {
        console.error(`Error fetching ${apiUrl}:`, e.message);
        return 0;
    }
}

async function updateDownloads() {
    const json = JSON.parse(fs.readFileSync(path, 'utf8'));
    let totalDownloads = 0;

    for (const theme of json.themes) {
        let themeTotal = 0;
        const apiKeys = Object.keys(theme).filter(key => key.startsWith('api') && theme[key]);
        for (const apiKey of apiKeys) {
            themeTotal += await getValueFromApi(theme[apiKey], theme.data_path);
        }
        theme.value = themeTotal.toString();
        totalDownloads += themeTotal;
    }

    json.total_downloads = totalDownloads.toString();

    fs.writeFileSync(path, JSON.stringify(json, null, 4));
}

updateDownloads();