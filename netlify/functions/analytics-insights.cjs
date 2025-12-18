// netlify/functions/analytics-insights.cjs
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { summary, audience = "internal" } = body;

    if (!summary || !summary.overview) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Analytics summary is required" })
      };
    }

    const apiKey = process.env.GEMINI_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "GEMINI_API_KEY environment variable not set" })
      };
    }

    const prompt = buildPrompt(summary, audience);
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
      const errorData = await safeJson(response);
      throw new Error(`API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    const insights = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!insights) {
      throw new Error("No content generated from API");
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        success: true,
        insights
      })
    };
  } catch (error) {
    console.error("Error generating analytics insights:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to generate insights",
        message: error.message
      })
    };
  }
};

function safeJson(response) {
  return response
    .json()
    .catch(() => ({ message: "Failed to parse error payload" }));
}

function buildPrompt(summary, audience) {
  const { overview = {}, filters = {}, topProducts = [], platformStats = [], retailerStats = [] } = summary;

  const overviewSection = [
    `Total Orders: ${formatNumber(overview.totalOrders)}`,
    `Total Units: ${formatNumber(overview.totalProducts)}`,
    `Total Revenue: ${formatCurrency(overview.totalRevenue)}`,
    `Total Shipping Cost: ${formatCurrency(overview.totalShippingCost)}`,
    `Avg Shipping Cost: ${formatCurrency(overview.avgShippingCost)}`,
    `Avg Order Value: ${formatCurrency(overview.avgOrderValue)}`
  ].join("\n");

  const filterSection = [
    filters.dateRange ? `Date Range: ${filters.dateRange}` : null,
    filters.platform && filters.platform !== "all" ? `Platform: ${filters.platform}` : null,
    filters.retailer && filters.retailer !== "all" ? `Retailer: ${filters.retailer}` : null
  ]
    .filter(Boolean)
    .join(", ");

  const topProductsSection = (topProducts || [])
    .slice(0, 5)
    .map(
      (product, idx) =>
        `#${idx + 1} ${cleanText(product.sku || "N/A")} (${cleanText(product.name || "Unnamed")}) - qty ${formatNumber(
          product.totalQty
        )}, orders ${formatNumber(product.orderCount)}${
          product.topPlatform ? `, top platform ${cleanText(product.topPlatform)}` : ""
        }`
    )
    .join("\n") || "None provided.";

  const platformSection = (platformStats || [])
    .slice(0, 5)
    .map(
      (platform) =>
        `${cleanText(platform.platform || platform.name || "Unknown")}: orders ${formatNumber(platform.orders)}, revenue ${formatCurrency(
          platform.revenue
        )}, shipping ${formatCurrency(platform.shippingCost)}, units ${formatNumber(platform.units)}`
    )
    .join("\n") || "None provided.";

  const retailerSection =
    (retailerStats || [])
      .slice(0, 5)
      .map(
        (retailer) =>
          `${cleanText(retailer.retailer || retailer.name || "Retailer")}: orders ${formatNumber(
            retailer.orders
          )}, avg order ${formatNumber(retailer.avgOrderSize)}, top product ${cleanText(retailer.topProduct || "N/A")}`
      )
      .join("\n") || "Unavailable.";

  const audienceContext =
    audience === "customer"
      ? "You are advising a retail customer reviewing their own purchasing behavior."
      : "You are advising the internal operations team reviewing overall business performance.";

  return `${audienceContext}

Use the analytics figures below to explain what matters. Highlight outliers, compare segments, and point out risks or opportunities.

Filters in effect: ${filterSection || "None (all data)."}

Overview:
${overviewSection}

Top Products:
${topProductsSection}

Platforms:
${platformSection}

Retailers (if applicable):
${retailerSection}

Respond with plain text only. Provide three concise bullet insights (start each line with "- ") plus a final "Takeaway:" sentence with an action or next step. Avoid repeating the raw numbers verbatim; interpret the trend or implication instead.`;
}

function formatNumber(value) {
  const num = typeof value === "number" ? value : parseFloat(value);
  if (Number.isFinite(num)) {
    return Math.round(num * 100) / 100;
  }
  return 0;
}

function formatCurrency(value) {
  const num = typeof value === "number" ? value : parseFloat(value);
  if (Number.isFinite(num)) {
    return `$${num.toFixed(2)}`;
  }
  return "$0.00";
}

function cleanText(value) {
  if (!value && value !== 0) return "";
  return String(value).replace(/\s+/g, " ").trim();
}
