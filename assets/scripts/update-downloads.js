const fs = require('fs');
const axios = require('axios');
const path = 'assets/data/downloads.json';

async function getValueFromApi(apiUrl, dataPath) {
    if (!apiUrl) return 0;
    try {
        const res = await axios.get(apiUrl, { timeout: 10000 });
        // GitHub Releases API: Array von Releases mit Assets
        if (apiUrl.includes('api.github.com/repos/') && Array.isArray(res.data)) {
            // Summiere alle download_count aus allen Assets aller Releases
            return res.data.reduce((sum, release) => {
                if (Array.isArray(release.assets)) {
                    return sum + release.assets.reduce((s, a) => s + (a.download_count || 0), 0);
                }
                return sum;
            }, 0);
        }
        // Standard: data_path auslesen (verschachtelt möglich)
        return parseInt(dataPath.split('.').reduce((obj, key) => obj && obj[key], res.data)) || 0;
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
        // Alle API-Felder finden (api, api2, api3, ...)
        const apiKeys = Object.keys(theme).filter(key => key.startsWith('api') && theme[key]);
        for (const apiKey of apiKeys) {
            // data_pathX für apiX, sonst data_path
            let suffix = apiKey.length > 3 ? apiKey.substring(3) : '';
            let dataPathKey = 'data_path' + suffix;
            let dataPath = theme[dataPathKey] || theme.data_path || '';
            themeTotal += await getValueFromApi(theme[apiKey], dataPath);
        }
        theme.value = themeTotal.toString();
        totalDownloads += themeTotal;
    }

    json.total_downloads = totalDownloads.toString();

    fs.writeFileSync(path, JSON.stringify(json, null, 4));
}

updateDownloads();