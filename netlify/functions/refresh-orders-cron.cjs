// netlify/functions/refresh-orders-cron.cjs
// Scheduled function that runs both Shippo and Faire refresh flows

const { refreshShippoOrders } = require('./shippo-refresh-orders.cjs');
const { refreshFaireOrders } = require('./faire-refresh-orders.cjs');
const shippoRemoveFulfilled = require('./shippo-remove-fulfilled-orders.cjs');

exports.handler = async function(event) {
  const shippoPayload = { ...(event || {}), skipStartDate: true, invokedBy: 'refresh-orders-cron' };
  let shippoResult;
  try {
    shippoResult = await refreshShippoOrders(shippoPayload);
  } catch (err) {
    console.error('[Refresh Orders Cron] Shippo refresh threw an error:', err);
    shippoResult = { statusCode: 500, body: `Shippo refresh error: ${err.message}` };
  }

  let faireResult;
  try {
    faireResult = await refreshFaireOrders({ ...(event || {}), invokedBy: 'refresh-orders-cron' });
  } catch (err) {
    console.error('[Refresh Orders Cron] Faire refresh threw an error:', err);
    faireResult = { statusCode: 500, body: `Faire refresh error: ${err.message}` };
  }

  let removeResult;
  try {
    removeResult = await shippoRemoveFulfilled.handler({ ...(event || {}), invokedBy: 'refresh-orders-cron' });
  } catch (err) {
    console.error('[Refresh Orders Cron] Shippo remove-fulfilled threw an error:', err);
    removeResult = { statusCode: 500, body: `Shippo remove-fulfilled error: ${err.message}` };
  }

  const responseSummary = {
    shippo: {
      statusCode: shippoResult?.statusCode ?? 500,
      body: shippoResult?.body ?? ''
    },
    faire: {
      statusCode: faireResult?.statusCode ?? 500,
      body: faireResult?.body ?? ''
    },
    shippoCleanup: {
      statusCode: removeResult?.statusCode ?? 500,
      body: removeResult?.body ?? ''
    }
  };

  const success = responseSummary.shippo.statusCode >= 200 && responseSummary.shippo.statusCode < 300 &&
                  responseSummary.faire.statusCode >= 200 && responseSummary.faire.statusCode < 300 &&
                  responseSummary.shippoCleanup.statusCode >= 200 && responseSummary.shippoCleanup.statusCode < 300;

  return {
    statusCode: success ? 200 : 500,
    body: JSON.stringify(responseSummary)
  };
};
