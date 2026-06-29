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


    // ===== LESSON ROUTES =====

    app.post("/api/lessons", verifyToken, async (req, res) => {
      try {
        const lesson = req.body;

        const newLesson = {
          title: lesson.title,
          description: lesson.description,
          category: lesson.category,
          emotionalTone: lesson.emotionalTone,
          image: lesson.image || "",
          visibility: lesson.visibility || "public",
          accessLevel: req.user.isPremium ? lesson.accessLevel : "free",
          likes: [],
          likesCount: 0,
          favoritesCount: 0,
          creatorId: req.user._id.toString(),
          creatorName: req.user.name,
          creatorEmail: req.user.email,
          creatorPhoto: req.user.photoURL || "",
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await lessonsCollection.insertOne(newLesson);
        res.status(201).send({
          success: true,
          lesson: {...newLesson, _id: result.insertedId},
        });
      } catch (error) {
        res.status(500).send({success: false, message: error.message});
      }
    });

    app.get("/api/lessons", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 6;
        const skip = (page - 1) * perPage;

        const {search, category, emotionalTone, sort} = req.query;
        const andConditions = [{visibility: "public"}];

        if (search) {
          andConditions.push({
            $or: [
              {title: {$regex: search, $options: "i"}},
              {description: {$regex: search, $options: "i"}},
            ],
          });
        }

        if (category && category !== "all") andConditions.push({category});
        if (emotionalTone && emotionalTone !== "all")
          andConditions.push({emotionalTone});

        const query = {$and: andConditions};

        let sortObj = {createdAt: -1};
        if (sort === "most_liked") sortObj = {likesCount: -1};
        if (sort === "most_saved") sortObj = {favoritesCount: -1};

        const total = await lessonsCollection.countDocuments(query);
        const lessons = await lessonsCollection
          .find(query)
          .sort(sortObj)
          .skip(skip)
          .limit(perPage)
          .toArray();

        const creatorIds = [...new Set(lessons.map((l) => l.creatorId))];
        const creators = await usersCollection
          .find({_id: {$in: creatorIds.map((id) => new ObjectId(id))}})
          .project({_id: 1, isPremium: 1})
          .toArray();

        const creatorPremiumMap = {};
        creators.forEach((c) => {
          creatorPremiumMap[c._id.toString()] = c.isPremium || false;
        });

        const enrichedLessons = lessons.map((lesson) => ({
          ...lesson,
          creatorIsPremium: creatorPremiumMap[lesson.creatorId] || false,
        }));

        res.send({
          lessons: enrichedLessons,
          total,
          page,
          perPage,
          totalPages: Math.ceil(total / perPage),
        });
      } catch (err) {
        res.status(500).send({message: err.message});
      }
    });

    // GET lessons for the logged-in user (token only, no param)
    app.get("/api/lessons/user", verifyToken, async (req, res) => {
      try {
        const lessons = await lessonsCollection
          .find({creatorId: req.user._id.toString()})
          .sort({createdAt: -1})
          .toArray();
        res.send({lessons});
      } catch (error) {
        res.status(500).send({message: error.message});
      }
    });

    // GET lessons by userId param — used by the overview dashboard
    app.get("/api/lessons/user/:userId", verifyToken, async (req, res) => {
      try {
        const lessons = await lessonsCollection
          .find({creatorId: req.params.userId})
          .sort({createdAt: -1})
          .toArray();
        res.send(lessons);
      } catch (error) {
        res.status(500).send({message: error.message});
      }
    });

    

//     console.log(" All routes registered successfully!");
//   } catch (error) {
//     console.error("Failed to connect to MongoDB:", error);
//   }
// }

// run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Welcome to learnora Server!");
});

app.listen(PORT, () => {
  console.log(` Server is running on port ${PORT}`);
  console.log(` Visit: http://localhost:${PORT}`);
});
