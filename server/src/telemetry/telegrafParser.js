/**
 * Parser for InfluxDB Line Protocol (used by Telegraf)
 * Format: <measurement>[,<tag_key>=<tag_value>[,<tag_key>=<tag_value>]] <field_key>=<field_value>[,<field_key>=<field_value>] [<timestamp>]
 * Example: cpu,host=server01,region=us-west usage_idle=93.4,value=0.64 1465839830100400200
 */

/**
 * Parses a single line of InfluxDB Line Protocol
 * @param {string} line 
 * @returns {object|null} Parsed metric object or null if invalid
 */
function parseLine(line) {
    if (!line || line.trim().startsWith('#')) return null;

    const trimmed = line.trim();
    
    // Regex to extract measurement, tags, fields, and optional timestamp
    // Group 1: Measurement
    // Group 2: Tags (optional)
    // Group 3: Fields
    // Group 4: Timestamp (optional)
    const regex = /^([^,\s]+)(?:,([^\s]+))?(\s+)([^=\s]+=[^\s]+(?:,[^=\s]+=[^\s]+)*)(?:\s+(\d+))?$/;
    const match = trimmed.match(regex);

    if (!match) {
        console.warn(`[TelegrafParser] Invalid line format: ${trimmed}`);
        return null;
    }

    const measurement = match[1];
    const tagsStr = match[2] || '';
    const fieldsStr = match[4];
    const timestamp = match[5] ? parseInt(match[5], 10) : Date.now();

    // Normalize timestamp to milliseconds if it's in nanoseconds (common for Telegraf)
    let tsMs = timestamp;
    if (tsMs > 10000000000000) {
        // Nanoseconds
        tsMs = Math.floor(tsMs / 1000000);
    } else if (tsMs > 10000000000) {
        // Microseconds
        tsMs = Math.floor(tsMs / 1000);
    } else if (tsMs < 1000000000000) {
        // Seconds
        tsMs = tsMs * 1000;
    }

    const tags = parseTags(tagsStr);
    const fields = parseFields(fieldsStr);

    if (Object.keys(fields).length === 0) {
        console.warn(`[TelegrafParser] No valid fields found in line: ${trimmed}`);
        return null;
    }

    return {
        measurement,
        tags,
        fields,
        timestamp: tsMs
    };
}

/**
 * Parses tags string into an object
 * @param {string} str 
 * @returns {object}
 */
function parseTags(str) {
    const tags = {};
    if (!str) return tags;

    // Simple split by comma, handling escaped commas is complex in one regex
    // For basic Telegraf usage, standard split works for most cases
    const pairs = str.split(',');
    for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key && value) {
            tags[key] = unescape(value);
        }
    }
    return tags;
}

/**
 * Parses fields string into an object with type inference
 * @param {string} str 
 * @returns {object}
 */
function parseFields(str) {
    const fields = {};
    if (!str) return fields;

    const pairs = splitFields(str);
    for (const pair of pairs) {
        const eqIndex = pair.indexOf('=');
        if (eqIndex === -1) continue;

        const key = pair.substring(0, eqIndex).trim();
        const valueStr = pair.substring(eqIndex + 1).trim();

        if (!key) continue;

        fields[key] = parseFieldValue(valueStr);
    }
    return fields;
}

/**
 * Splits fields string respecting quoted strings
 * @param {string} str 
 * @returns {array}
 */
function splitFields(str) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        
        if (char === '"' && str[i-1] !== '\\') {
            inQuotes = !inQuotes;
            current += char;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    if (current) result.push(current);
    
    return result;
}

/**
 * Infers type and parses field value
 * @param {string} val 
 * @returns {number|string|boolean}
 */
function parseFieldValue(val) {
    // Boolean
    if (val === 'T' || val === 't' || val === 'true') return true;
    if (val === 'F' || val === 'f' || val === 'false') return false;

    // Integer (ends with i)
    if (val.endsWith('i')) {
        const num = parseInt(val.slice(0, -1), 10);
        return isNaN(num) ? val : num;
    }

    // Float
    if (!isNaN(val) && val.includes('.')) {
        return parseFloat(val);
    }

    // Integer
    if (!isNaN(val)) {
        return parseInt(val, 10);
    }

    // String (quoted)
    if (val.startsWith('"') && val.endsWith('"')) {
        return unescape(val.slice(1, -1));
    }

    return val;
}

/**
 * Unescapes InfluxDB special characters
 * @param {string} str 
 * @returns {string}
 */
function unescape(str) {
    return str
        .replace(/\\,/g, ',')
        .replace(/\\=/g, '=')
        .replace(/\\ /g, ' ')
        .replace(/\\"/g, '"');
}

/**
 * Parses bulk input (multiple lines)
 * @param {string} body 
 * @returns {array} Array of parsed metrics
 */
function parseBulk(body) {
    const lines = body.split('\n');
    const metrics = [];
    
    for (const line of lines) {
        const parsed = parseLine(line);
        if (parsed) {
            metrics.push(parsed);
        }
    }
    
    return metrics;
}

// ES module export
export default {
    parseLine,
    parseBulk
};
