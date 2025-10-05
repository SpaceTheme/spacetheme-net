const fs = require('fs');
const { execSync } = require('child_process');
const path = 'assets/data/downloads.json';

function curlJson(url) {
    try {
        const result = execSync(`curl -sL "${url}"`, { encoding: 'utf8', timeout: 10000 });
        return JSON.parse(result);
    } catch (e) {
        console.error(`Error fetching ${url}:`, e.message);
        return null;
    }
}

function getValueFromApi(apiUrl, dataPath) {
    if (!apiUrl) return 0;
    const res = curlJson(apiUrl);
    if (!res) return 0;

    // GitHub Releases API: Array von Releases mit Assets
    if (apiUrl.includes('api.github.com/repos/') && Array.isArray(res)) {
        // Summiere alle download_count aus allen Assets aller Releases
        return res.reduce((sum, release) => {
            if (Array.isArray(release.assets)) {
                return sum + release.assets.reduce((s, a) => s + (a.download_count || 0), 0);
            }
            return sum;
        }, 0);
    }
    // Standard: data_path auslesen (verschachtelt möglich)
    return parseInt(dataPath.split('.').reduce((obj, key) => obj && obj[key], res)) || 0;
}

function updateDownloads() {
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
            themeTotal += getValueFromApi(theme[apiKey], dataPath);
        }
        theme.value = themeTotal.toString();
        totalDownloads += themeTotal;
    }

    json.total_downloads = totalDownloads.toString();

    fs.writeFileSync(path, JSON.stringify(json, null, 4));
}

updateDownloads();