// netlify/functions/shippo-manifest.cjs
// Endpoint to create a daily manifest/scanform using Shippo API

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

exports.handler = async (event) => {
  // Validate request
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ error: 'Method Not Allowed' }) 
    };
  }

  const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
  if (!SHIPPO_API_KEY) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Missing Shippo API token.' }) 
    };
  }

  let body;
  try { 
    body = JSON.parse(event.body); 
  } catch (err) { 
    return { 
      statusCode: 400, 
      body: JSON.stringify({ error: 'Invalid JSON body.' }) 
    }; 
  }

  const { date, carrier_account, transaction_ids } = body;

  // Default to today if no date provided
  const manifestDate = date || new Date().toISOString().split('T')[0];
  
  // Convert date to datetime format for Shippo API (start of day in UTC)
  const shipmentDateTime = `${manifestDate}T00:00:00Z`;
  console.log(`[Shippo Manifest] Using shipment_date: ${shipmentDateTime}`);

  try {
    let manifestPayload = {
      shipment_date: shipmentDateTime,
      address_from: {
        name: 'J&L Naturals',
        street1: "125 N Commercial Dr #103",
        city: 'Mooreseville',
        state: 'NC',
        zip: '28115',
        country: 'US',
        phone: '7046777577',
        email: 'jenn@jnlnaturals.com'
      }
    };

    // Only add carrier_account if it's specified and not 'auto'
    if (carrier_account && carrier_account !== 'auto') {
      manifestPayload.carrier_account = carrier_account;
    }

    // If specific transaction IDs are provided, use them
    if (transaction_ids && Array.isArray(transaction_ids) && transaction_ids.length > 0) {
      manifestPayload.transactions = transaction_ids;
      console.log(`[Shippo Manifest] Using provided transaction IDs: ${transaction_ids.length} transactions`);
      
      // For provided transaction IDs, we'll use a default provider (can be enhanced later)
      manifestPayload.provider = 'usps'; // Default to USPS, can be made configurable
    } else {
      // Get all transactions for today
      console.log('[Shippo Manifest] Fetching transactions for date:', manifestDate);
      
      // Try to fetch transactions with date parameter first
      let transactionsUrl = 'https://api.goshippo.com/transactions/';
      
      const transactionsResponse = await fetch(transactionsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!transactionsResponse.ok) {
        throw new Error(`Failed to fetch transactions: ${transactionsResponse.statusText}`);
      }

      const transactionsData = await transactionsResponse.json();
      
      console.log(`[Shippo Manifest] Fetched ${transactionsData.results?.length || 0} total transactions`);
      if (transactionsData.results?.length > 0) {
        console.log('[Shippo Manifest] Sample transaction fields:', Object.keys(transactionsData.results[0]));
        console.log('[Shippo Manifest] Sample transaction:', {
          object_id: transactionsData.results[0].object_id,
          created: transactionsData.results[0].created,
          object_created: transactionsData.results[0].object_created,
          eta: transactionsData.results[0].eta,
          status: transactionsData.results[0].status,
          has_label: !!transactionsData.results[0].label_url
        });
      }
      
      // Filter transactions for today's date
      const todayTransactions = transactionsData.results?.filter(transaction => {
        try {
          // Check multiple possible date fields
          const dateField = transaction.created || transaction.object_created || transaction.eta;
          if (!dateField) {
            console.warn(`[Shippo Manifest] No date field found for transaction ${transaction.object_id}`);
            return false;
          }
          
          const transactionDateObj = new Date(dateField);
          if (isNaN(transactionDateObj.getTime())) {
            console.warn(`[Shippo Manifest] Invalid date for transaction ${transaction.object_id}: ${dateField}`);
            return false;
          }
          
          const transactionDate = transactionDateObj.toISOString().split('T')[0];
          const matches = transactionDate === manifestDate && 
                         transaction.status === 'SUCCESS' && 
                         transaction.label_url && // Ensure it has a label
                         !transaction.object_state?.includes('VALID'); // Don't include already manifested transactions
          
          if (matches) {
            console.log(`[Shippo Manifest] Including transaction ${transaction.object_id} from ${transactionDate}`, {
              status: transaction.status,
              object_state: transaction.object_state,
              has_label: !!transaction.label_url,
              tracking_status: transaction.tracking_status
            });
          } else if (transactionDate === manifestDate) {
            console.log(`[Shippo Manifest] Excluding transaction ${transaction.object_id}:`, {
              status: transaction.status,
              object_state: transaction.object_state,
              has_label: !!transaction.label_url,
              tracking_status: transaction.tracking_status,
              reason: transaction.status !== 'SUCCESS' ? 'not SUCCESS status' : 
                      !transaction.label_url ? 'no label_url' :
                      transaction.object_state?.includes('VALID') ? 'already manifested' : 'unknown'
            });
          }
          
          return matches;
        } catch (error) {
          console.warn(`[Shippo Manifest] Error processing transaction ${transaction.object_id}:`, error.message);
          return false;
        }
      }) || [];

      if (todayTransactions.length === 0) {
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            message: `No shipments found for ${manifestDate}. Create some shipping labels first or try a different date.`,
            date: manifestDate,
            transaction_count: 0,
            total_transactions_checked: transactionsData.results?.length || 0
          })
        };
      }

      manifestPayload.transactions = todayTransactions.map(t => t.object_id);
      console.log(`[Shippo Manifest] Found ${todayTransactions.length} transactions for ${manifestDate}`);
      
      // Determine the carrier/provider from the transactions
      if (todayTransactions.length > 0) {
        const firstTransaction = todayTransactions[0];
        console.log('[Shippo Manifest] Checking transaction for carrier info:', {
          object_id: firstTransaction.object_id,
          rate: firstTransaction.rate,
          tracking_status: firstTransaction.tracking_status,
          object_state: firstTransaction.object_state
        });
        
        // Try to get provider from rate information
        if (firstTransaction.rate) {
          try {
            // Fetch the rate details to get the provider
            const rateResponse = await fetch(`https://api.goshippo.com/rates/${firstTransaction.rate}`, {
              method: 'GET',
              headers: {
                'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
                'Content-Type': 'application/json'
              }
            });
            
            if (rateResponse.ok) {
              const rateData = await rateResponse.json();
              console.log('[Shippo Manifest] Rate data:', {
                provider: rateData.provider,
                servicelevel: rateData.servicelevel,
                carrier_account: rateData.carrier_account
              });
              
              if (rateData.carrier_account) {
                manifestPayload.carrier_account = rateData.carrier_account;
                console.log(`[Shippo Manifest] Using carrier_account: ${rateData.carrier_account}`);
              }
              
              // Use provider as backup if carrier_account is not available
              if (!manifestPayload.carrier_account && rateData.provider) {
                manifestPayload.provider = rateData.provider;
                console.log(`[Shippo Manifest] Using provider: ${rateData.provider}`);
              }
            } else {
              console.warn('[Shippo Manifest] Failed to fetch rate details:', rateResponse.statusText);
            }
          } catch (rateError) {
            console.warn('[Shippo Manifest] Error fetching rate details:', rateError.message);
          }
        }
        
        // Fallback to USPS if no carrier_account or provider found
        if (!manifestPayload.carrier_account && !manifestPayload.provider) {
          manifestPayload.provider = 'usps';
          console.log('[Shippo Manifest] Using fallback provider: usps');
        }
        
        // Additional validation - check if transactions can be manifested
        console.log('[Shippo Manifest] Validating transactions before manifest creation...');
        for (const transaction of todayTransactions) {
          console.log(`[Shippo Manifest] Transaction ${transaction.object_id}:`, {
            status: transaction.status,
            object_state: transaction.object_state,
            tracking_status: transaction.tracking_status,
            has_label: !!transaction.label_url,
            created: transaction.object_created
          });
        }
      }
    }

    // Create manifest
    console.log('[Shippo Manifest] Creating manifest with payload:', manifestPayload);

    const manifestResponse = await fetch('https://api.goshippo.com/manifests/', {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(manifestPayload)
    });

    if (!manifestResponse.ok) {
      const errorText = await manifestResponse.text();
      console.error('[Shippo Manifest] Error response:', errorText);
      throw new Error(`Manifest creation failed: ${manifestResponse.statusText} - ${errorText}`);
    }

    const manifestData = await manifestResponse.json();
    console.log('[Shippo Manifest] Manifest created successfully:', manifestData);

    // Return manifest data including the PDF URL
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        manifest: manifestData,
        manifest_url: manifestData.documents?.find(doc => doc.type === 'PDF')?.url || manifestData.label_url,
        transaction_count: manifestPayload.transactions?.length || 0,
        date: manifestDate
      })
    };

  } catch (error) {
    console.error('[Shippo Manifest] Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Failed to create manifest', 
        details: error.message 
      })
    };
  }
};
