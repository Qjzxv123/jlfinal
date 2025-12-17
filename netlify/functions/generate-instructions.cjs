// netlify/functions/generate-instructions.cjs
exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { phaseTitle, ingredients, existingInstructions } = body;

    if (!phaseTitle || !ingredients || ingredients.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Phase title and ingredients are required" })
      };
    }

    // Get API key from environment
    const apiKey = process.env.GEMINI_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "GEMINI_API_KEY environment variable not set" })
      };
    }

    // Format ingredients for the prompt
    const ingredientsList = ingredients
      .map((ing) => `- ${ing.name || ing.sku} (${ing.quantity} ${ing.unit}, ${ing.scope})`)
      .join("\n");

    const prompt = `You are a cosmetic manufacturing expert. Generate clear, concise step-by-step instructions for a manufacturing phase.

IMPORTANT: Use PLAIN TEXT only. NO markdown formatting, NO special characters.

Phase Title: ${phaseTitle}

Ingredients for this phase:
${ingredientsList}

${existingInstructions ? `Current instructions (if any): ${existingInstructions}\n\n` : ""}

Please generate detailed but practical manufacturing instructions for this phase. Include:
1. Preparation steps
2. Mixing/combining procedures
3. Temperature or timing considerations if relevant
4. Safety notes if needed

Keep the instructions concise (2-5 sentences) and practical for manufacturing. Output as plain text paragraphs only.`;

    // Call the Gemini 2.5 Flash Lite API endpoint directly
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    const instructions = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!instructions) {
      throw new Error("No content generated from API");
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        success: true,
        instructions: instructions
      })
    };
  } catch (error) {
    console.error("Error generating instructions:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to generate instructions",
        message: error.message
      })
    };
  }
};
