export default {
  async fetch(request, env, ctx) {
    console.log(`Received ${request.method} request to ${request.url}`);
    
    const url = new URL(request.url);
    
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }
    
    // GET /products - Fetch all products from KV
    if (request.method === 'GET' && url.pathname === '/products') {
      try {
        console.log('Fetching all products from KV...');
        
        // Check if KV binding exists
        if (!env.PRODUCTS_KV) {
          return new Response(JSON.stringify({ 
            error: 'Products KV binding not configured' 
          }), {
            status: 500,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        
        // Get all keys from KV
        const keys = await env.PRODUCTS_KV.list();
        console.log(`Found ${keys.keys.length} product keys`);
        
        if (keys.keys.length === 0) {
          return new Response(JSON.stringify([]), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        
        // Fetch all products in parallel
        const productsPromises = keys.keys.map(key => 
          env.PRODUCTS_KV.get(key.name, { type: 'json' })
        );
        
        const products = await Promise.all(productsPromises);
        
        // Filter out any null values
        const validProducts = products.filter(p => p !== null);
        
        console.log(`Returning ${validProducts.length} products`);
        
        return new Response(JSON.stringify(validProducts), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (error) {
        console.error('Products error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // GET /product/:id - Fetch single product from KV
    if (request.method === 'GET' && url.pathname.startsWith('/product/')) {
      const productId = url.pathname.split('/').pop();
      
      try {
        console.log(`Fetching product ${productId} from KV...`);
        
        // Check if KV binding exists
        if (!env.PRODUCTS_KV) {
          return new Response(JSON.stringify({ 
            error: 'Products KV binding not configured' 
          }), {
            status: 500,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        
        const product = await env.PRODUCTS_KV.get(productId, { type: 'json' });
        
        if (product) {
          console.log(`Found product: ${product.name}`);
          return new Response(JSON.stringify(product), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        } else {
          console.log(`Product ${productId} not found`);
          return new Response(JSON.stringify({ error: 'Product not found' }), {
            status: 404,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      } catch (error) {
        console.error(`Error fetching product ${productId}:`, error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // POST /checkout - Store order in D1
    if (request.method === 'POST' && url.pathname === '/checkout') {
      try {
        console.log('Processing checkout request...');
        
        // Parse request body
        const body = await request.json();
        console.log('Checkout request received');
        
        // Validate required fields
        const { name, phone, address, items } = body;
        
        if (!name || !phone || !address || !items || !Array.isArray(items)) {
          return new Response(JSON.stringify({ 
            error: 'Missing required fields: name, phone, address, items (array)' 
          }), {
            status: 400,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        
        // Validate items
        if (items.length === 0) {
          return new Response(JSON.stringify({ 
            error: 'Cart is empty' 
          }), {
            status: 400,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        
        // Validate each item
        for (const item of items) {
          if (!item.id || !item.quantity || item.quantity < 1) {
            return new Response(JSON.stringify({ 
              error: 'Each item must have id and valid quantity (≥1)',
              invalidItem: item
            }), {
              status: 400,
              headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              }
            });
          }
          
          // Verify product exists in KV (optional but good for validation)
          try {
            if (env.PRODUCTS_KV) {
              const product = await env.PRODUCTS_KV.get(item.id, { type: 'json' });
              if (!product) {
                console.warn(`Product ${item.id} not found in KV during checkout`);
              }
            }
          } catch (kvError) {
            console.warn('KV check skipped:', kvError.message);
          }
        }
        
        // Generate unique ID
        const orderId = `ord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const createdAt = Math.floor(Date.now() / 1000);
        
        // Convert items array to JSON string for storage
        const itemsJson = JSON.stringify(items);
        
        // Check if D1 binding exists
        if (!env.DB) {
          return new Response(JSON.stringify({ 
            error: 'Database binding not configured' 
          }), {
            status: 500,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        
        // Insert order into D1 database
        const result = await env.DB.prepare(
          "INSERT INTO orders (id, name, phone, address, items, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(orderId, name, phone, address, itemsJson, createdAt).run();
        
        console.log(`Order saved to D1 with ID: ${orderId}`);
        
        // Return success response
        return new Response(JSON.stringify({
          success: true,
          orderId: orderId,
          message: 'Order placed successfully',
          timestamp: createdAt,
          created_at: new Date(createdAt * 1000).toISOString(),
          summary: {
            customer: name,
            itemCount: items.length,
            totalItems: items.reduce((sum, item) => sum + item.quantity, 0)
          }
        }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
        
      } catch (error) {
        console.error('Checkout error:', error);
        
        // Check if error is due to missing table
        if (error.message && error.message.includes('no such table')) {
          return new Response(JSON.stringify({ 
            error: 'Orders table not found. Please run the schema.sql file first.',
            details: error.message
          }), {
            status: 500,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        
        return new Response(JSON.stringify({ 
          error: error.message 
        }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // GET /orders - View orders from D1 (for admin/testing)
    if (request.method === 'GET' && url.pathname === '/orders') {
      try {
        console.log('Fetching orders from D1...');
        
        // Check if D1 binding exists
        if (!env.DB) {
          return new Response(JSON.stringify({ 
            error: 'Database binding not configured' 
          }), {
            status: 500,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        
        const { results } = await env.DB.prepare(
          "SELECT id, name, phone, address, created_at FROM orders ORDER BY created_at DESC"
        ).all();
        
        console.log(`Found ${results.length} orders`);
        
        // Parse items JSON for each order
        const ordersWithParsedItems = await Promise.all(
          results.map(async (order) => {
            try {
              const fullOrder = await env.DB.prepare(
                "SELECT * FROM orders WHERE id = ?"
              ).bind(order.id).first();
              
              if (fullOrder && fullOrder.items) {
                return {
                  ...order,
                  items: JSON.parse(fullOrder.items),
                  created_at: new Date(order.created_at * 1000).toISOString()
                };
              }
              return order;
            } catch (parseError) {
              console.error(`Error parsing items for order ${order.id}:`, parseError);
              return {
                ...order,
                items: [],
                created_at: new Date(order.created_at * 1000).toISOString(),
                parseError: parseError.message
              };
            }
          })
        );
        
        return new Response(JSON.stringify(ordersWithParsedItems), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (error) {
        console.error('Orders error:', error);
        
        // Check if error is due to missing table
        if (error.message && error.message.includes('no such table')) {
          return new Response(JSON.stringify({ 
            error: 'Orders table not found. No orders have been placed yet.',
            details: error.message
          }), {
            status: 404,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // GET /order/:id - Get specific order
    if (request.method === 'GET' && url.pathname.startsWith('/order/')) {
      const orderId = url.pathname.split('/').pop();
      
      try {
        console.log(`Fetching order ${orderId} from D1...`);
        
        if (!env.DB) {
          return new Response(JSON.stringify({ 
            error: 'Database binding not configured' 
          }), {
            status: 500,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        
        const order = await env.DB.prepare(
          "SELECT * FROM orders WHERE id = ?"
        ).bind(orderId).first();
        
        if (order) {
          // Parse items JSON
          const orderWithParsedItems = {
            ...order,
            items: JSON.parse(order.items),
            created_at: new Date(order.created_at * 1000).toISOString()
          };
          
          return new Response(JSON.stringify(orderWithParsedItems), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        } else {
          return new Response(JSON.stringify({ error: 'Order not found' }), {
            status: 404,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      } catch (error) {
        console.error(`Error fetching order ${orderId}:`, error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // Health check endpoint
    if (request.method === 'GET' && url.pathname === '/health') {
      const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          kv: !!env.PRODUCTS_KV,
          d1: !!env.DB
        }
      };
      
      return new Response(JSON.stringify(health), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Default response
    return new Response(JSON.stringify({
      message: 'E-commerce API',
      endpoints: [
        'GET  /products - List all products',
        'GET  /product/:id - Get single product',
        'POST /checkout - Place an order',
        'GET  /orders - List all orders (admin)',
        'GET  /order/:id - Get specific order',
        'GET  /health - Health check'
      ],
      note: 'Products are stored in KV, orders are stored in D1'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};