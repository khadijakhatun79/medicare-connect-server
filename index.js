const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;


/* ================= MIDDLEWARE ================= */

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

/* ================= DB ================= */

const client = new MongoClient(process.env.MONGODB_URI);
let db;

/* ================= AUTH MIDDLEWARE ================= */

const verifyToken = (req, res, next) => {
  try {
    const token =
      req.cookies?.token ||
      req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    next();
  } catch (err) {
    return res.status(401).send({ message: "Invalid Token" });
  }
}; 

/* ================= CONNECT DB ================= */

async function run() {
  try {
    await client.connect();
    db = client.db("medicareconnect");

    const usersCollection = db.collection("users");
    const doctorsCollection = db.collection("doctors");
    const appointmentsCollection = db.collection("appointments");
    const reviewsCollection = db.collection("reviews");

    /* ================= ROOT ================= */

    app.get("/", (req, res) => {
      res.send("MediCare Connect Connect Server Running"); 
    });

    /* ================= AUTH (simple demo) ================= */

    app.post("/auth/login", async (req, res) => {
      const user = req.body;

      const token = jwt.sign(
        {
          email: user.email,
          role: user.role || "patient",
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      res
        .cookie("token", token, {
          httpOnly: true,
          secure: false,
        })
        .send({ success: true, token });
    });

    /* ================= DOCTORS ================= */

    app.get("/doctors", async (req, res) => {
      try {
        const { search, sort, page = 1, limit = 10 } = req.query;

        let query = {};

        if (search) {
          query.specialty = { $regex: search, $options: "i" };
        }

        let sortOption = {};
        if (sort === "fee") sortOption = { fee: 1 };
        if (sort === "experience") sortOption = { experience: -1 };
        if (sort === "rating") sortOption = { rating: -1 };

        const result = await doctorsCollection
          .find(query)
          .sort(sortOption)
          .skip((parseInt(page) - 1) * parseInt(limit))
          .limit(parseInt(limit))
          .toArray();

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch doctors" });
      }
    });

    app.get("/doctors/:id", async (req, res) => {
      try {
        const result = await doctorsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Doctor not found" });
      }
    });

    app.get("/featured-doctors", async (req, res) => {
      const result = await doctorsCollection
        .find()
        .sort({ rating: -1 })
        .limit(3)
        .toArray();

      res.send(result);
    });

    /* ================= APPOINTMENTS ================= */

    app.post("/appointments", verifyToken, async (req, res) => {
      const result = await appointmentsCollection.insertOne({
        ...req.body,
        status: "pending",
        createdAt: new Date(),
      });

      res.send({
        success: true,
        insertedId: result.insertedId,
      });
    });

    app.get("/appointments", async (req, res) => {
      const email = req.query.email;

      const result = await appointmentsCollection
        .find({ userEmail: email })
        .toArray();

      res.send(result);
    });

    app.patch("/appointments/:id", async (req, res) => {
      const result = await appointmentsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body }
      );

      res.send(result);
    });

    app.delete("/appointments/:id", async (req, res) => {
      const result = await appointmentsCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });

      res.send(result);
    });

    /* ================= USERS ================= */

    app.patch("/users/:email", async (req, res) => {
      const result = await usersCollection.updateOne(
        { email: req.params.email },
        { $set: req.body }
      );

      res.send(result);
    });

    /* ================= REVIEWS ================= */

    app.post("/reviews", verifyToken, async (req, res) => {
      const result = await reviewsCollection.insertOne({
        ...req.body,
        createdAt: new Date(),
      });

      res.send(result);
    });

    app.get("/reviews/:doctorId", async (req, res) => {
      const result = await reviewsCollection
        .find({ doctorId: req.params.doctorId })
        .toArray();

      res.send(result);
    });

    console.log("MongoDB Connected Successfully");
  } catch (err) {
    console.log(err);
  }
}

run();

/* ================= SERVER ================= */

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});