

export function isQuestion(text, language = 'es') {

    text = text.trim().toLowerCase();
  
    // Check if the text is empty
    if (text.length === 0) {
      return false;
    }
  
    const questionWords = /^(qué|que|quién|quien|cómo|como|cuál|cual|cuándo|cuando|dónde|donde|por qué|por que|cuánto|cuanto|cuánta|cuanta|cuántos|cuantos|cuántas|cuantas)/;
  
    // Check if the text starts with a question word
    if (questionWords.test(text)) {
      return true;
    }
  
    // Check if the text ends with a question mark
    if (text.endsWith('?')) {
      return true;
    }
  
    // Check for inverted question mark at the beginning
    if (text.startsWith('¿')) {
      return true;
    }
  
    // Check for verb-subject inversion (common in Spanish questions)
    const verbSubjectInversion = /^(es|está|son|están|ha|han|puede|pueden|quiere|quieren|va|van|tiene|tienen|hace|hacen|sabe|saben|conoce|conocen|entiende|entienden)/;
    if (verbSubjectInversion.test(text)) {
      return true;
    }
  
    // If none of the above conditions are met, it's likely not a question
    return false;
  }