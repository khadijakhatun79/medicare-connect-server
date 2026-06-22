const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

/* ================= MIDDLEWARE ================= */
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

/* ================= DB ================= */
const client = new MongoClient(process.env.MONGODB_URI);

let usersCollection;
let doctorsCollection;
let appointmentsCollection;
let reviewsCollection;
let paymentsCollection;
let prescriptionsCollection;

/* ================= AUTH ================= */
const verifyToken = (req, res, next) => {
  const token =
    req.cookies?.token ||
    req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).send({ message: "Invalid Token" });
  }
};

/* ================= ROLE ================= */
const verifyRole = (role) => (req, res, next) => {
  if (req.user.role !== role) {
    return res.status(403).send({ message: "Forbidden" });
  }
  next();
};

/* ================= CONNECT DB ================= */
async function run() {
  try {
    await client.connect();
    const db = client.db("medicareconnect");

    usersCollection = db.collection("users");
    doctorsCollection = db.collection("doctors");
    appointmentsCollection = db.collection("appointments");
    reviewsCollection = db.collection("reviews");
    paymentsCollection = db.collection("payments");
    prescriptionsCollection = db.collection("prescriptions");

    console.log("✅ MongoDB Connected");

/* ================= ROOT ================= */
app.get("/", (req, res) => {
  res.send("MediCare API Running");
});

/* ================= USERS ================= */
app.post("/users", async (req, res) => {
  const user = req.body;

  const exists = await usersCollection.findOne({ email: user.email });
  if (exists) return res.send({ message: "User already exists" });

  const result = await usersCollection.insertOne({
    ...user,
    role: user.role || "patient",
    createdAt: new Date(),
  });

  res.send(result);
});

/* ================= LOGIN ================= */
app.post("/auth/login", async (req, res) => {
  const { email } = req.body;

  const user = await usersCollection.findOne({ email });
  if (!user) return res.status(401).send({ message: "Invalid credentials" });

  const token = jwt.sign(
    { email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
  });

  res.send({ token });
});

/* ================= PROFILE ================= */
app.get("/me", verifyToken, async (req, res) => {
  const user = await usersCollection.findOne({ email: req.user.email });
  res.send(user || {});
});

app.patch("/me", verifyToken, async (req, res) => {
  const result = await usersCollection.updateOne(
    { email: req.user.email },
    { $set: req.body }
  );

  res.send(result);
});

/* ================= DOCTORS ================= */
app.get("/doctors", async (req, res) => {
  const doctors = await doctorsCollection.find().toArray();
  res.send(doctors);
});

app.post("/doctors", verifyToken, async (req, res) => {
  const result = await doctorsCollection.insertOne({
    ...req.body,
    verificationStatus: "pending",
  });

  res.send(result);
});

app.patch(
  "/doctors/verify/:id",
  verifyToken,
  verifyRole("admin"),
  async (req, res) => {
    const result = await doctorsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { verificationStatus: "verified" } }
    );

    res.send(result);
  }
);

/* ================= APPOINTMENTS ================= */
app.post("/appointments", verifyToken, async (req, res) => {
  const result = await appointmentsCollection.insertOne({
    ...req.body,
    patientEmail: req.user.email,
    status: "pending",
    createdAt: new Date(),
  });

  res.send(result);
});

app.get("/appointments", verifyToken, async (req, res) => {
  const result = await appointmentsCollection
    .find({ patientEmail: req.user.email })
    .toArray();

  res.send(result);
});

app.patch("/appointments/:id", verifyToken, async (req, res) => {
  const result = await appointmentsCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: req.body }
  );

  res.send(result);
});

app.delete("/appointments/:id", verifyToken, async (req, res) => {
  const result = await appointmentsCollection.deleteOne({
    _id: new ObjectId(req.params.id),
  });

  res.send(result);
});

/* ================= REVIEWS ================= */
app.post("/reviews", verifyToken, async (req, res) => {
  const result = await reviewsCollection.insertOne({
    ...req.body,
    patientEmail: req.user.email,
    createdAt: new Date(),
  });

  res.send(result);
});

app.get("/reviews/me", verifyToken, async (req, res) => {
  const result = await reviewsCollection
    .find({ patientEmail: req.user.email })
    .toArray();

  res.send(result);
});

app.delete("/reviews/:id", verifyToken, async (req, res) => {
  const result = await reviewsCollection.deleteOne({
    _id: new ObjectId(req.params.id),
  });

  res.send(result);
});

/* ================= PAYMENTS ================= */
app.post("/payments", verifyToken, async (req, res) => {
  const result = await paymentsCollection.insertOne({
    ...req.body,
    patientEmail: req.user.email,
    createdAt: new Date(),
  });

  res.send(result);
});

app.get("/payments", verifyToken, async (req, res) => {
  const result = await paymentsCollection
    .find({ patientEmail: req.user.email })
    .toArray();

  res.send(result);
});

/* ================= PRESCRIPTIONS ================= */
app.post("/prescriptions", verifyToken, async (req, res) => {
  const result = await prescriptionsCollection.insertOne({
    ...req.body,
    createdAt: new Date(),
  });

  res.send(result);
});

app.get("/prescriptions", verifyToken, async (req, res) => {
  const result = await prescriptionsCollection
    .find({ patientEmail: req.user.email })
    .toArray();

  res.send(result);
});

  } catch (err) {
    console.error("DB Error:", err);
  }
}

run();

/* ================= SERVER ================= */
app.listen(port, () => {
  console.log(`Server running on port ${port}`); 
});