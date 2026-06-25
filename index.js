const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const Stripe = require("stripe");

const stripe = process.env.STRIPE_SECRET_KEY
  ? Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

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
    //await client.connect();
    const db = client.db("medicareconnect");
   

    usersCollection = db.collection("users");
    doctorsCollection = db.collection("doctors");
    appointmentsCollection = db.collection("appointments");
    reviewsCollection = db.collection("reviews");
    paymentsCollection = db.collection("payments");
    prescriptionsCollection = db.collection("prescriptions");

    console.log("✅ MongoDB Connected");



    
    
/* ================= DEBUG DOCTORS ================= */
app.get("/debug-doctors", async (req, res) => {
  try {
    const doctors = await doctorsCollection.find({}).toArray();

    res.status(200).json({
      total: doctors.length,
      doctors,
    });
  } catch (error) {
    res.status(500).json({
      message: "Debug error",
    });
  }
});

/* ================= ROOT ================= */
app.get("/", (req, res) => {
  res.send("MediCare API Running");
});

/* ================= USERS ================= */
app.post("/users", async (req, res) => {
  try {
    const user = req.body;

    const exists = await usersCollection.findOne({
      email: user.email,
    });

    if (exists) {
      return res.send({
        message: "User already exists",
      });
    }

   const newUser = {
  name: user.name,
  email: user.email,
  phone: user.phone || "",
  gender: user.gender || "",
  photo: user.photo || "",
  role: user.role || "patient",
  status: "active",
  createdAt: new Date(),
};

    const result =
      await usersCollection.insertOne(
        newUser
      );

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to create user",
    });
  }
});

/* ================= ADMIN USERS ================= */

app.get(
  "/admin/users",
  verifyToken,
  verifyRole("admin"),
  async (req, res) => {
    const users = await usersCollection.find().toArray();

    res.send({
      success: true,
      data: users,
    });
  }
);

app.patch(
  "/admin/users/:id/status",
  verifyToken,
  verifyRole("admin"),
  async (req, res) => {
    const { status } = req.body;

    const result =
      await usersCollection.updateOne(
        {
          _id: new ObjectId(req.params.id),
        },
        {
          $set: { status },
        }
      );

    res.send(result);
  }
);

app.delete(
  "/admin/users/:id",
  verifyToken,
  verifyRole("admin"),
  async (req, res) => {
    const result =
      await usersCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });

    res.send(result);
  }
);


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

app.post("/auth/logout", (req, res) => {
  res.clearCookie("token");

  res.send({
    success: true,
  });
});

app.get("/users/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const user = await usersCollection.findOne({
      email,
    });

    if (!user) {
      return res.status(404).send({
        success: false,
        message: "User not found",
      });
    }

    res.send(user);
  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

app.get("/patient/profile", verifyToken, async (req, res) => {
  console.log("DECODED TOKEN:", req.user);

  const patient = await usersCollection.findOne({
    email: req.user.email,
  });

  console.log("FOUND USER:", patient?.email);

  res.send(patient);
});

app.get("/admin/analytics", async (req, res) => {
  const totalPatients = await usersCollection.countDocuments({
    role: "patient",
  });

  const totalDoctors = await usersCollection.countDocuments({
    role: "doctor",
  });

  const totalAppointments =
    await appointmentsCollection.countDocuments();

  const payments =
    await paymentsCollection.find().toArray(); 

  const revenue = payments.reduce(
    (sum, item) => sum + (item.amount || 0),
    0
  );

  res.send({
    totalPatients,
    totalDoctors,
    totalAppointments,
    revenue,
  });
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

app.get(
  "/user-role",
  verifyToken,
  async (req, res) => {
    const user =
      await usersCollection.findOne({
        email: req.user.email,
      });

    res.send({
      role: user?.role || "patient",
    });
  }
);

/* ================= DOCTORS ================= */ 
app.get("/doctors", async (req, res) => {
  const doctors = await doctorsCollection.find().toArray();
  res.send(doctors);
});

/* ================= ADMIN DOCTORS ================= */ 

app.get( 
  "/admin/doctors",
  verifyToken,
  verifyRole("admin"),
  async (req, res) => {
    const doctors =
      await doctorsCollection.find().toArray();

    res.send({
      success: true,
      data: doctors,
    });
  }
);

app.patch(
  "/admin/doctors/:id/verify",
  verifyToken,
  verifyRole("admin"),
  async (req, res) => {
    const { status } = req.body;

    const result =
      await doctorsCollection.updateOne(
        {
          _id: new ObjectId(req.params.id),
        },
        {
          $set: {
            verificationStatus: status,
          },
        }
      );

    res.send(result);
  }
);

app.post("/doctors", verifyToken, async (req, res) => {
  const result = await doctorsCollection.insertOne({
    ...req.body,
    verificationStatus: "Pending",
  });

  res.send(result);
});

app.get("/doctors/:id", async (req, res) => {
  try {
    const doctor = await doctorsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!doctor) {
      return res.status(404).send({
        message: "Doctor not found",
      });
    }

    res.send(doctor);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch doctor",
    });
  }
});  

/* ================= APPOINTMENTS ================= */

app.post(
  "/appointments",
  verifyToken,
  async (req, res) => {
    try {
      const appointment = {
        ...req.body,

        patientEmail: req.user.email,

        doctorEmail: req.body.doctorEmail,

        status: "pending",

        paymentStatus: "unpaid",

        createdAt: new Date(),
      };

      const result =
        await appointmentsCollection.insertOne(
          appointment
        );

      res.send({
        insertedId:
          result.insertedId.toString(),
      });
    } catch (error) {
      console.error(error);

      res.status(500).send({
        message:
          "Failed to create appointment",
      });
    }
  }
);

/* ================= ADMIN APPOINTMENTS ================= */

app.get(
  "/admin/appointments",
  verifyToken,
  verifyRole("admin"),
  async (req, res) => {
    const appointments =
      await appointmentsCollection.find().toArray();

    res.send({
      success: true,
      data: appointments,
    });
  }
);

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

app.get(
  "/payment-history",
  verifyToken,
  async (req, res) => {
    try {
      const payments =
        await paymentsCollection
          .find({
            patientEmail: req.user.email,
          })
          .toArray();

      res.send(payments);
    } catch (error) {
      res.status(500).send({
        message: "Failed to fetch payments",
      });
    }
  }
);

/* ================= ADMIN PAYMENTS ================= */

app.get(
  "/admin/payments",
  verifyToken,
  verifyRole("admin"),
  async (req, res) => {
    const payments =
      await paymentsCollection.find().toArray();

    res.send({
      success: true,
      data: payments,
    });
  }
);

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

app.get(
  "/reviews",
  async (req, res) => {

    const doctorId =
      req.query.doctorId;

    const reviews =
      await reviewsCollection
        .find({ doctorId })
        .toArray();

    res.send(reviews);
  }
);

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

/* ================= ADMIN STATS ================= */

app.get(
  "/admin/stats",
  verifyToken,
  verifyRole("admin"),
  async (req, res) => {
    const totalUsers =
      await usersCollection.countDocuments();

    const totalDoctors =
      await doctorsCollection.countDocuments();

    const totalAppointments =
      await appointmentsCollection.countDocuments();

    const totalPayments =
      await paymentsCollection.countDocuments();

    const payments =
      await paymentsCollection.find().toArray();

    const revenue = payments.reduce(
      (sum, payment) =>
        sum + (payment.amount || 0),
      0
    );

    res.send({
      totalUsers,
      totalDoctors,
      totalAppointments,
      totalPayments,
      revenue,
    });
  }
);

/* ================= DOCTOR APPOINTMENTS ================= */

app.get(
  "/doctor/appointments",
  verifyToken,
  verifyRole("doctor"),
  async (req, res) => {
    const appointments =
      await appointmentsCollection
        .find({
          doctorEmail: req.user.email,
        })
        .toArray();

    res.send(appointments);
  }
);

app.patch(
  "/doctor/appointments/:id",
  verifyToken,
  verifyRole("doctor"),
  async (req, res) => {
    const result =
      await appointmentsCollection.updateOne(
        {
          _id: new ObjectId(req.params.id),
        },
        {
          $set: req.body,
        }
      );

    res.send(result);
  }
);

app.post(
  "/doctor/prescriptions",  
  verifyToken,
  verifyRole("doctor"),
  async (req, res) => {
    const prescription = {
      ...req.body,
      doctorEmail: req.user.email,
      createdAt: new Date(),
    };

    const result =
      await prescriptionsCollection.insertOne(
        prescription
      );

    res.send(result);
  }
);
app.get(
  "/doctor/prescriptions",
  verifyToken,
  verifyRole("doctor"),
  async (req, res) => {

    const prescriptions =
      await prescriptionsCollection
        .find({
          doctorEmail: req.user.email,
        })
        .toArray();

    res.send(prescriptions);
  }
);
app.get(
  "/doctor/profile",
  verifyToken,
  verifyRole("doctor"),
  async (req, res) => {
    const doctor =
      await doctorsCollection.findOne({
        email: req.user.email,
      });

    res.send(doctor);
  }
);

app.get(
  "/patient/profile",
  verifyToken,
  async (req, res) => {
    const patient =
      await usersCollection.findOne({
        email: req.user.email,
      });

    res.send(patient);
  }
);

app.get(
  "/patient/stats",
  verifyToken,
  async (req, res) => {

    const appointments =
      await appointmentsCollection.countDocuments({
        patientEmail: req.user.email,
      });

    const payments =
      await paymentsCollection.countDocuments({
        patientEmail: req.user.email,
      });

    const prescriptions =
      await prescriptionsCollection.countDocuments({
        patientEmail: req.user.email,
      });

    res.send({
      appointments,
      payments,
      prescriptions,
    });
  }
);

app.get(
  "/patient/dashboard",
  verifyToken,
  async (req, res) => {
    try {
      const email = req.user.email;

      const patient = await usersCollection.findOne({
        email,
      });

      const appointments = await appointmentsCollection
        .find({ patientEmail: email })
        .sort({ createdAt: -1 })
        .toArray();

      const payments = await paymentsCollection
        .find({ patientEmail: email })
        .toArray();

      const reviews = await reviewsCollection
        .find({ patientEmail: email })
        .toArray();

      const totalPayments = payments.reduce(
        (sum, item) => sum + (item.amount || 0),
        0
      );

      res.send({
        patient,
        stats: {
          upcomingAppointments: appointments.filter(
            (a) =>
              a.status === "pending" ||
              a.status === "confirmed"
          ).length,

          totalAppointments: appointments.length,

          totalPayments,

          reviews: reviews.length,
        },

        appointments: appointments.slice(0, 5),
        payments: payments.slice(0, 5),
        reviews: reviews.slice(0, 5),
      });
    } catch (error) {
      res.status(500).send({
        message: "Dashboard fetch failed",
      });
    }
  }
);

app.get(
  "/dashboard-summary",
  verifyToken,
  verifyRole("admin"),
  async (req, res) => {

    const users =
      await usersCollection.countDocuments();

    const doctors =
      await doctorsCollection.countDocuments();

    const appointments =
      await appointmentsCollection.countDocuments();

    const payments =
      await paymentsCollection.countDocuments();

    res.send({
      users,
      doctors,
      appointments,
      payments,
    });
  }
);

app.get(
  "/doctor/stats",
  verifyToken,
  verifyRole("doctor"),
  async (req, res) => {

    const appointments =
      await appointmentsCollection.countDocuments({
        doctorEmail: req.user.email,
      });

    const prescriptions =
      await prescriptionsCollection.countDocuments({
        doctorEmail: req.user.email,
      });

    res.send({
      appointments,
      prescriptions,
    });
  }
);
/* ================= STRIPE CHECKOUT ================= */
app.post("/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).send({
        message: "Stripe not configured",
      });
    }

    const {
      appointmentId,
      doctorName,
      fee,
    } = req.body;

    if (
      !appointmentId ||
      !doctorName ||
      !fee
    ) {
      return res.status(400).send({
        message: "Missing fields",
      });
    }

    const session =
      await stripe.checkout.sessions.create({
        payment_method_types: ["card"],

        mode: "payment",

        metadata: {
          appointmentId,
        },

        line_items: [
          {
            quantity: 1,

            price_data: {
              currency: "usd",

              product_data: {
                name: `Appointment with ${doctorName}`,
              },

              unit_amount:
                Number(fee) * 100,
            },
          },
        ],

        success_url:
          `${process.env.CLIENT_URL}/payment-success?appointmentId=${appointmentId}`,

        cancel_url:
          `${process.env.CLIENT_URL}/payment-cancel`,
      });

    res.send({
      url: session.url,
    });
  } catch (error) {
    console.error(
      "Stripe Checkout Error:",
      error
    );

    res.status(500).send({
      message: "Stripe session failed",
    });
  }
});
app.patch(
  "/appointments/payment-success/:id",
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({
          message: "Invalid appointment id",
        });
      }

      const appointment =
        await appointmentsCollection.findOne({
          _id: new ObjectId(id),
        });

      if (!appointment) {
        return res.status(404).send({
          message: "Appointment not found",
        });
      }

      await appointmentsCollection.updateOne(
        {
          _id: new ObjectId(id),
        },
        {
          $set: {
            paymentStatus: "paid",
            status: "confirmed",
            paidAt: new Date(),
          },
        }
      );

      await paymentsCollection.insertOne({
        appointmentId: id,
        doctorName: appointment.doctorName,
        patientEmail: appointment.patientEmail,
        amount: appointment.fee,
        status: "paid",
        createdAt: new Date(),
      });

      res.send({
        success: true,
      });
    } catch (error) {
      console.error(error);

      res.status(500).send({
        message: "Payment update failed",
      });
    }
  }
);

  } catch (err) {
    console.error("DB Error:", err); 
  }
}

run();
/* ================= FEATURED DOCTORS ================= */
app.get("/featured-doctors", async (req, res) => {
  try {
    const result = await doctorsCollection
      .find({
        verificationStatus: "Verified"
      })
      .limit(6)
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch featured doctors",
    });
  }
});

/* ================= SERVER ================= */
app.listen(port, () => {
  console.log(`Server running on port ${port}`);  
});