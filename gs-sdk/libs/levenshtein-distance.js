// File: gs-distance-util.js

class gsDistanceUtil {
  constructor() {
    // List of common English stop words
    this.stopWords = new Set([
      "a",
      "al",
      "algo",
      "algunas",
      "algunos",
      "ante",
      "antes",
      "como",
      "con",
      "contra",
      "cual",
      "cuando",
      "de",
      "del",
      "desde",
      "donde",
      "durante",
      "e",
      "el",
      "ella",
      "ellas",
      "ellos",
      "en",
      "entre",
      "era",
      "erais",
      "eran",
      "eras",
      "eres",
      "es",
      "esa",
      "esas",
      "ese",
      "eso",
      "esos",
      "esta",
      "estaba",
      "estabais",
      "estaban",
      "estabas",
      "estad",
      "estada",
      "estadas",
      "estado",
      "estados",
      "estamos",
      "estando",
      "estar",
      "estaremos",
      "estará",
      "estarán",
      "estarás",
      "estaré",
      "estaréis",
      "estaría",
      "estaríais",
      "estaríamos",
      "estarían",
      "estarías",
      "estas",
      "este",
      "estemos",
      "esto",
      "estos",
      "estoy",
      "estuve",
      "estuviera",
      "estuvierais",
      "estuvieran",
      "estuvieras",
      "estuvieron",
      "estuviese",
      "estuvieseis",
      "estuviesen",
      "estuvieses",
      "estuvimos",
      "estuviste",
      "estuvisteis",
      "estuviéramos",
      "estuviésemos",
      "estuvo",
      "hola",
      "holas",
      "hello",
      "hi",
      "la",
      "las",
      "le",
      "les",
      "lo",
      "los",
      "me",
      "mi",
      "mis",
      "mucho",
      "muchos",
      "muy",
      "más",
      "mí",
      "mía",
      "mías",
      "mío",
      "míos",
      "nada",
      "ni",
      "no",
      "nos",
      "nosotras",
      "nosotros",
      "nuestra",
      "nuestras",
      "nuestro",
      "nuestros",
      "o",
      "os",
      "otra",
      "otras",
      "otro",
      "otros",
      "para",
      "pero",
      "poco",
      "por",
      "porque",
      "que",
      "quien",
      "quienes",
      "qué",
      "se",
      "sea",
      "seamos",
      "sean",
      "seas",
      "sed",
      "si",
      "sin",
      "sobre",
      "sois",
      "somos",
      "son",
      "soy",
      "su",
      "sus",
      "suya",
      "suyas",
      "suyo",
      "suyos",
      "sí",
      "también",
      "tanto",
      "te",
      "tendremos",
      "tendrá",
      "tendrán",
      "tendrás",
      "tendré",
      "tendréis",
      "tendría",
      "tendríais",
      "tendríamos",
      "tendrían",
      "tendrías",
      "tened",
      "tenemos",
      "tenga",
      "tengamos",
      "tengan",
      "tengas",
      "tengo",
      "tenida",
      "tenidas",
      "tenido",
      "tenidos",
      "teniendo",
      "tenéis",
      "tienes",
      "todo",
      "todos",
      "tu",
      "tus",
      "tuve",
      "tuviera",
      "tuvierais",
      "tuvieran",
      "tuvieras",
      "tuvieron",
      "tuviese",
      "tuvieseis",
      "tuviesen",
      "tuvieses",
      "tuvimos",
      "tuviste",
      "tuvisteis",
      "tuvisteis",
      "tuvimos",
      "tuviéramos",
      "tuviésemos",
      "tuvo",
      "tuya",
      "tuyas",
      "tuyo",
      "tuyos",
      "tú",
      "un",
      "una",
      "uno",
      "unos",
      "vosotras",
      "vosotros",
      "vuestra",
      "vuestras",
      "vuestro",
      "vuestros",
      "y",
      "ya",
      "yo"
    ]);
  }

  levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    
    // Create a matrix of size (m+1) x (n+1)
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    // Fill the first row and column
    for (let i = 0; i <= m; i++) {
      dp[i][0] = i;
    }
    for (let j = 0; j <= n; j++) {
      dp[0][j] = j;
    }
    
    // Fill the rest of the matrix
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,  // deletion
            dp[i][j - 1] + 1,  // insertion
            dp[i - 1][j - 1] + 1  // substitution
          );
        }
      }
    }
    
    // The bottom-right cell contains the Levenshtein distance
    return dp[m][n];
  }

  removeStopWords(str) {
    if (!str || typeof str !== 'string') {
      return '';
    }
    const words = str.toLowerCase().match(/\b(\w+)\b/g);
    return words ? words.filter(word => !this.stopWords.has(word)).join(' ') : '';
  }

  normalizeText(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    return this.removeStopWords(text.toLowerCase().replace(/[^\w\s]/g, ''));
  }

  findEntityInText(entities, text) {
    const normalizedText = this.normalizeText(text);
    const textWords = normalizedText.split(/\s+/);

    for (const entity of entities) {
      const normalizedEntity = this.normalizeText(entity);
      
      if (normalizedEntity.length <= 1) {
        continue;
      }

      const entityWords = normalizedEntity.split(/\s+/);

      for (let i = 0; i <= textWords.length - entityWords.length; i++) {
        let isMatch = true;
        const matchedWords = [];

        for (let j = 0; j < entityWords.length; j++) {
          const textWord = textWords[i + j];
          const entityWord = entityWords[j];
          const maxDistance = this.getMaxDistance(entityWord.length);

          const distance = this.levenshteinDistance(textWord, entityWord);

          if (distance > maxDistance) {
            isMatch = false;
            break;
          }
          matchedWords.push(textWord);
        }

        if (isMatch && matchedWords.length > 0) {
          return {
            found: true,
            match: {
              entity: entity,
              matchedText: matchedWords.join(' '),
              position: i
            }
          };
        }
      }
    }

    return { found: false };
  }

  getMaxDistance(wordLength) {
    if (wordLength <= 3) return 0;
    if (wordLength <= 7) return 1;
    return 2;
  }
  
}

// Add the class to the global scope
if (typeof window !== 'undefined') {
  // Browser environment
  window.gsDistanceUtil = gsDistanceUtil;
} else if (typeof global !== 'undefined') {
  // Node.js environment
  global.gsDistanceUtil = gsDistanceUtil;
} else {
  // Fallback for other environments
  this.gsDistanceUtil = gsDistanceUtil;
}