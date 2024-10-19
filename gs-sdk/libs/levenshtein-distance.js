// File: levenshtein-distance.js

function gsLevenshteinDistance(str1, str2) {
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

// Add the function to the global scope
if (typeof window !== 'undefined') {
  // Browser environment
  window.gsLevenshteinDistance = gsLevenshteinDistance;
} else if (typeof global !== 'undefined') {
  // Node.js environment
  global.gsLevenshteinDistance = gsLevenshteinDistance;
} else {
  // Fallback for other environments
  this.gsLevenshteinDistance = gsLevenshteinDistance;
}

// You can add more GS-prefixed functions here if needed