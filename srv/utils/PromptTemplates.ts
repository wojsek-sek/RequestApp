/** Prompt templates for AI integrations (kept separate from handler logic). */
export const PROMPTS = {
    GENERATE_JUSTIFICATION: (items: string, categories: string, userLocale: string) => `
        You are a corporate professional.
        Write a concise business justification (max 2-3 sentences) for purchasing the following items: ${items} and their categories: ${categories}.
        The justification must sound natural, citing work optimization, health and safety, or project requirements.
        Do not use any introductory phrases. Return strictly the raw text ready to be pasted into a form.

        CRITICAL INSTRUCTION: You must write the final response strictly in the language corresponding to this ISO locale code: '${userLocale}'.
    `,
};
