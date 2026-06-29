const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const {MongoClient, ServerApiVersion, ObjectId} = require("mongodb");

dotenv.config({path: ".env"});

console.log(" Environment Check:");
console.log(
  "  - STRIPE_SECRET_KEY:",
  process.env.STRIPE_SECRET_KEY ? " Present" : " Missing",
);
console.log("  - CLIENT_URL:", process.env.CLIENT_URL || "Not set");
console.log("  - PORT:", process.env.PORT || 8000);
console.log(
  "  - MONGODB_URI:",
  process.env.MONGODB_URI ? " Present" : " Missing",
);

const uri = process.env.MONGODB_URI;
const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);

let stripe = null;
try {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (stripeSecretKey && stripeSecretKey.startsWith("sk_")) {
    stripe = require("stripe")(stripeSecretKey);
    console.log(" Stripe initialized successfully");
  } else {
    console.error(" Invalid STRIPE_SECRET_KEY format or missing");
  }
} catch (error) {
  console.error(" Failed to initialize Stripe:", error.message);
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// async function run() {
//   try {
//     await client.connect();
//     await client.db("admin").command({ping: 1});
//     console.log(" Connected to MongoDB!");

    const db = client.db("ghurni");
    const usersCollection = db.collection("user");
    const sessionCollection = db.collection("session");
    const lessonsCollection = db.collection("lessons");
    const favoritesCollection = db.collection("favorites");
    const commentsCollection = db.collection("lessonComments");
    const lessonReportsCollection = db.collection("lessonReports");

    // ===== MIDDLEWARE =====

    const verifyToken = async (req, res, next) => {
      const authHeader = req.headers?.authorization;
      if (!authHeader)
        return res.status(401).send({message: "unauthorized access"});

      const token = authHeader.split(" ")[1];
      if (!token) return res.status(401).send({message: "unauthorized access"});

      const session = await sessionCollection.findOne({token});
      if (!session)
        return res.status(401).send({message: "unauthorized access"});

      const user = await usersCollection.findOne({_id: session.userId});
      if (!user) return res.status(401).send({message: "unauthorized access"});

      req.user = user;
      next();
    };

    const verifyAdmin = (req, res, next) => {
      if (req.user?.role !== "admin")
        return res.status(403).send({message: "forbidden"});
      next();
    };

    const getUserFromToken = async (req) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) return null;
      const token = authHeader.split(" ")[1];
      if (!token) return null;
      const session = await sessionCollection.findOne({token});
      if (!session) return null;
      const user = await usersCollection.findOne({_id: session.userId});
      return user || null;
    };

    // ===== SESSION UPDATE =====

    async function updateUserSessions(userId, updateData) {
      try {
        const result = await sessionCollection.updateMany(
          {userId},
          {
            $set: {
              isPremium: updateData.isPremium,
              premiumActivatedAt: updateData.premiumActivatedAt,
              updatedAt: new Date(),
            },
          },
        );

        console.log(`Updated ${result.modifiedCount} sessions`);
      } catch (err) {
        console.error(err);
      }
    }

;

app.get("/", (req, res) => {
  res.send("Welcome to learnora Server!");
});

app.listen(PORT, () => {
  console.log(` Server is running on port ${PORT}`);
  console.log(` Visit: http://localhost:${PORT}`);
});
