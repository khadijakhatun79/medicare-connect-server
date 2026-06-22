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

let usersCollection;
let doctorsCollection;
let appointmentsCollection;
let reviewsCollection;
let paymentsCollection;

/* ================= AUTH ================= */

const verifyToken = (req, res, next) => {
  try {
    const token =
      req.cookies?.token ||
      req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }
};

const verifyRole = (role) => {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    next();
  };
};

/* ================= DATABASE ================= */

async function run() {
  try {
    await client.connect();

    const db = client.db("medicareconnect");

    usersCollection = db.collection("users");
    doctorsCollection = db.collection("doctors");
    appointmentsCollection = db.collection("appointments");
    reviewsCollection = db.collection("reviews");
    paymentsCollection = db.collection("payments");

    console.log("MongoDB Connected");

    /* ================= ROOT ================= */

    app.get("/", (req, res) => {
      res.json({
        success: true,
        message: "MediCare API Running",
      });
    });

    /* ================= USERS ================= */

    app.post("/users", async (req, res) => {
      try {
        const user = req.body;

        const existingUser =
          await usersCollection.findOne({
            email: user.email,
          });

        if (existingUser) {
          return res.json({
            success: true,
            message: "User already exists",
          });
        }

        const result =
          await usersCollection.insertOne({
            ...user,
            role: user.role || "patient",
            createdAt: new Date(),
          });

        res.json({
          success: true,
          data: result,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: "User creation failed",
        });
      }
    });

    /* ================= LOGIN ================= */

    app.post("/auth/login", async (req, res) => {
      try {
        const { email, password } = req.body;

        const user =
          await usersCollection.findOne({
            email,
          });

        if (!user || user.password !== password) {
          return res.status(401).json({
            success: false,
            message: "Invalid credentials",
          });
        }

        const token = jwt.sign(
          {
            email: user.email,
            role: user.role,
          },
          process.env.JWT_SECRET,
          {
            expiresIn: "7d",
          }
        );

        res.cookie("token", token, {
          httpOnly: true,
          secure:
            process.env.NODE_ENV === "production",
          sameSite:
            process.env.NODE_ENV === "production"
              ? "none"
              : "lax",
        });

        res.json({
          success: true,
          token,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Login failed",
        });
      }
    });

    /* ================= PROFILE ================= */

    app.get("/me", verifyToken, async (req, res) => {
      const user =
        await usersCollection.findOne({
          email: req.user.email,
        });

      res.json(user || {});
    });

    app.patch("/me", verifyToken, async (req, res) => {
      const result =
        await usersCollection.updateOne(
          {
            email: req.user.email,
          },
          {
            $set: req.body,
          }
        );

      res.json({
        success: true,
        data: result,
      });
    });

    /* ================= DOCTORS ================= */

    app.get("/doctors", async (req, res) => {
      try {
        const {
          search,
          sort,
          page = 1,
          limit = 10,
        } = req.query;

        let query = {};

        if (search) {
          query.$or = [
            {
              doctorName: {
                $regex: search,
                $options: "i",
              },
            },
            {
              specialization: {
                $regex: search,
                $options: "i",
              },
            },
          ];
        }

        let sortOption = {};

        if (sort === "fee")
          sortOption = {
            consultationFee: 1,
          };

        if (sort === "experience")
          sortOption = {
            experience: -1,
          };

        if (sort === "rating")
          sortOption = {
            rating: -1,
          };

        const doctors =
          await doctorsCollection
            .find(query)
            .sort(sortOption)
            .skip(
              (parseInt(page) - 1) *
                parseInt(limit)
            )
            .limit(parseInt(limit))
            .toArray();

        res.json(doctors);
      } catch (error) {
        res.status(500).json({
          success: false,
        });
      }
    });

    /* ================= APPOINTMENTS ================= */

    app.get(
      "/appointments",
      verifyToken,
      async (req, res) => {
        const appointments =
          await appointmentsCollection
            .find({
              patientEmail: req.user.email,
            })
            .toArray();

        res.json(appointments);
      }
    );

    app.post(
      "/appointments",
      verifyToken,
      async (req, res) => {
        const result =
          await appointmentsCollection.insertOne({
            ...req.body,
            patientEmail: req.user.email,
            status: "pending",
            createdAt: new Date(),
          });

        res.json(result);
      }
    );

    app.patch(
      "/appointments/:id",
      verifyToken,
      async (req, res) => {
        const result =
          await appointmentsCollection.updateOne(
            {
              _id: new ObjectId(
                req.params.id
              ),
            },
            {
              $set: req.body,
            }
          );

        res.json(result);
      }
    );

    app.delete(
      "/appointments/:id",
      verifyToken,
      async (req, res) => {
        const result =
          await appointmentsCollection.deleteOne({
            _id: new ObjectId(
              req.params.id
            ),
          });

        res.json(result);
      }
    );

    /* ================= REVIEWS ================= */

    app.post(
      "/reviews",
      verifyToken,
      async (req, res) => {
        const result =
          await reviewsCollection.insertOne({
            ...req.body,
            patientEmail: req.user.email,
            createdAt: new Date(),
          });

        res.json(result);
      }
    );

    app.get(
      "/reviews/me",
      verifyToken,
      async (req, res) => {
        const reviews =
          await reviewsCollection
            .find({
              patientEmail:
                req.user.email,
            })
            .toArray();

        res.json(reviews);
      }
    );

    app.delete(
      "/reviews/:id",
      verifyToken,
      async (req, res) => {
        const result =
          await reviewsCollection.deleteOne({
            _id: new ObjectId(
              req.params.id
            ),
          });

        res.json(result);
      }
    );

    /* ================= PAYMENTS ================= */

    app.get(
      "/payments",
      verifyToken,
      async (req, res) => {
        const payments =
          await paymentsCollection
            .find({
              patientEmail:
                req.user.email,
            })
            .toArray();

        res.json(payments);
      }
    );

    app.post(
      "/payments",
      verifyToken,
      async (req, res) => {
        const result =
          await paymentsCollection.insertOne({
            ...req.body,
            patientEmail:
              req.user.email,
            createdAt: new Date(),
          });

        res.json(result);
      }
    );

    /* ================= ADMIN ================= */

    app.patch(
      "/doctors/verify/:id",
      verifyToken,
      verifyRole("admin"),
      async (req, res) => {
        const result =
          await doctorsCollection.updateOne(
            {
              _id: new ObjectId(
                req.params.id
              ),
            },
            {
              $set: {
                verificationStatus:
                  "verified",
              },
            }
          );

        res.json(result);
      }
    );
  } catch (error) {
    console.error("DB Error:", error);
  }
}

run();

/* ================= SERVER ================= */

app.listen(port, () => {
  console.log(
    `Server running on port ${port}`
  );
});