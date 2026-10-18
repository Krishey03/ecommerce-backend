const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const authRouter = require('./routes/auth/auth-routes');
const adminProductsRouter = require('./routes/admin/products-routes');
const shopProductsRouter = require('./routes/shop/products-routes');
const messageRoutes = require('./routes/chat/message-routes');
const http = require('http');
const { initializeKhaltiPayment, verifyKhaltiPayment } = require("./khalti");
const Product = require("./models/Product");
const adminRoutes = require('./routes/admin/admin-routes');
const PaymentTransaction = require('./models/paymentTransaction');
const Order = require('./models/Order');
const userProductsRouter = require('./routes/user/products-routes');

require('dotenv').config();
const cache = require('./helpers/cache');
cache.startCleanup(60000);

const app = express();
const server = http.createServer(app);

// Validate critical environment variables
if (!process.env.KHALTI_SECRET_KEY || !process.env.KHALTI_GATEWAY_URL) {
  console.error("FATAL ERROR: Khalti environment variables missing!");
  process.exit(1);
}

// Allowed origins for local development
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

// Socket.io setup
const io = require("socket.io")(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
    console.log(`User ${socket.id} joined chat ${chatId}`);
  });

  socket.on('leave_chat', (chatId) => {
    socket.leave(chatId);
    console.log(`User ${socket.id} left chat ${chatId}`);
  });

  socket.on('typing', (chatId) => {
    socket.to(chatId).emit('typing', chatId);
  });

  socket.on('stop_typing', (chatId) => {
    socket.to(chatId).emit('stop_typing', chatId);
  });

  socket.on('disconnect', () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;

// Connect to local MongoDB
mongoose
  .connect(process.env.MONGODB_URI, {
  })
  .then(() => console.log('Local MongoDB Connected successfully'))
  .catch((error) => {
    console.error('MongoDB Connection Error:', error);
    console.log('Please make sure MongoDB is running on your system');
    process.exit(1);
  });

// Serve static files from Product_Images
app.use('/uploads', express.static(path.join(__dirname, 'Product_Images')));

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`Blocked by CORS: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  credentials: true,
  exposedHeaders: ['Authorization'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Preflight handling
app.options("/initialize-product-payment", cors(corsOptions));
app.options("/complete-khalti-payment", cors(corsOptions));

// Initialize Khalti payment for products
app.post("/initialize-product-payment", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(500).json({
        success: false,
        message: "Database connection not ready"
      });
    }

    const { productId, website_url } = req.body;
    const PROCESSING_FEE = 5;
    const DELIVERY_FEE = 25;
    
    const productData = await Product.findById(productId);
    if (!productData) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }
    
    const productName = productData.title;
    const baseAmount = Number(productData.price || 0);
    const totalAmount = baseAmount + PROCESSING_FEE + DELIVERY_FEE;

    const amountInPaisa = Math.round(totalAmount * 100);
    if (amountInPaisa < 100) {
      return res.status(400).json({
        success: false,
        message: "Amount too small (minimum 1 NPR)"
      });
    }
    
    // Create payment record
    const paymentRecord = await PaymentTransaction.create({
      productId: productId,
      productModel: 'Product',
      baseAmount: baseAmount,
      processingFee: PROCESSING_FEE,
      deliveryFee: DELIVERY_FEE,
      amount: totalAmount,
      paymentMethod: "khalti"
    });
    
    const backendBase = process.env.BACKEND_URI.endsWith('/') 
      ? process.env.BACKEND_URI.slice(0, -1) 
      : process.env.BACKEND_URI;

    const paymentInitiate = await initializeKhaltiPayment({
      amount: amountInPaisa,
      purchase_order_id: paymentRecord._id.toString(),
      purchase_order_name: productName,
      return_url: `${backendBase}/complete-khalti-payment`,
      website_url,
    });

    await PaymentTransaction.findByIdAndUpdate(
      paymentRecord._id,
      { pidx: paymentInitiate.pidx }
    );

    res.json({
      success: true,
      payment: paymentInitiate,
      paymentRecord,
      feeBreakdown: {
        baseAmount,
        processingFee: PROCESSING_FEE,
        deliveryFee: DELIVERY_FEE
      }
    });
  } catch (error) {
    console.error("Payment initialization error:", {
      message: error.message,
      stack: error.stack,
      body: req.body
    });
    res.status(500).json({
      success: false,
      message: "Failed to initialize payment",
      error: error.message
    });
  }
});

// Handle Khalti payment verification callback
app.get("/complete-khalti-payment", async (req, res) => {
  try {
    const { pidx } = req.query;
    
    if (!pidx) {
      console.error("Missing pidx in callback");
      return res.redirect(`${process.env.FRONTEND_URL}/payment-failed?reason=missing_pidx`);
    }
    
    console.log("Verifying payment with pidx:", pidx);
    
    const verificationResponse = await verifyKhaltiPayment(pidx);
    console.log("Khalti verification response:", JSON.stringify(verificationResponse, null, 2));
    
    const paymentRecord = await PaymentTransaction.findOne({ pidx: pidx });

    if (!paymentRecord) {
      console.error("Payment record not found for pidx:", pidx);
      return res.redirect(`${process.env.FRONTEND_URL}/payment-failed?reason=record_not_found`);
    }
    
    paymentRecord.status = "completed";
    paymentRecord.transactionDetails = verificationResponse;
    await paymentRecord.save();
    
    // Update product and create order
    const product = await Product.findById(paymentRecord.productId);
    if (product) {
      product.paymentStatus = "paid";
      product.paymentDate = new Date();
      product.paymentId = paymentRecord._id;
      product.isSold = true;
      await product.save();

      // Create order
      await Order.create({
        product: product._id,
        buyer: product.buyerEmail || product.bidderEmail,
        seller: product.sellerEmail,
        amount: paymentRecord.amount,
        paymentId: paymentRecord._id,
        status: 'pending'
      });
    }
    
    return res.redirect(`${process.env.FRONTEND_URL}/payment-success?purchase_order_id=${paymentRecord._id}`);
  } catch (error) {
    console.error("Payment verification error:", {
      message: error.message,
      stack: error.stack,
      query: req.query
    });
    return res.redirect(`${process.env.FRONTEND_URL}/payment-failed?reason=verification_error`);
  }
});

// Get payment status
app.get("/payment/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await PaymentTransaction.findById(paymentId);
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found"
      });
    }
    
    res.json({
      success: true,
      payment
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get payment details",
      error: error.message
    });
  }
});

// Mount routers
app.use("/auth", authRouter);
app.use('/admin/products', adminProductsRouter);
app.use('/user/products', userProductsRouter);
app.use('/shop/products', shopProductsRouter);
app.use('/admin', adminRoutes);
app.use('/chat', messageRoutes);

// Make io accessible to routes
app.set('io', io);
app.options('*', cors(corsOptions));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    dbStatus: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    socketConnections: io.engine.clientsCount
  });
});

// 404 handler
app.use((req, res) => {
  console.error(`404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: "Endpoint not found"
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl
  });
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: err.message
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));