require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
const corsOptions = {
    origin: ["http://localhost:5173", "http://localhost:5174", "https://adoptipet.web.app"],
    credentials: true,
    optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

const uri = process.env.MONGODB_URI;

const verifyToken = async (req, res, next) => {
    const token = req.cookies?.token;

    if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
    }
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            console.log(err);
            return res.status(401).send({ message: "unauthorized access" });
        }
        req.user = decoded;
        next();
    });
};

// MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        const db = client.db("AdoptiPetDB");
        const usersCollection = db.collection("users");
        const petCollection = db.collection("allPets");

        //generate jwt
        app.post("/jwt", (req, res) => {
            const email = req.body.email;

            if (!email) {
                return res.status(400).send({ success: false, message: "Email is required" });
            }

            //token creation
            const accessToken = jwt.sign({ email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "20d" });
            res.cookie("token", accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
            }).send({ success: true });
        });
        // Logout
        app.get("/logout", async (req, res) => {
            try {
                res.clearCookie("token", {
                    maxAge: 0,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
                }).send({ success: true });
            } catch (err) {
                res.status(500).send(err);
            }
        });

        // save or update a users info in db
        app.post("/user", async (req, res) => {
            const userData = req.body;
            userData.role = "user";
            userData.created_at = new Date().toISOString();
            userData.last_loggedIn = new Date().toISOString();
            const query = {
                email: userData?.email,
            };
            const userExists = await usersCollection.findOne(query);

            if (!!userExists) {
                const result = await usersCollection.updateOne(query, {
                    $set: { last_loggedIn: new Date().toISOString() },
                });
                return res.send(result);
            }

            const result = await usersCollection.insertOne(userData);
            res.send(result);
        });

        // POST API endpoint for Adding a pet
        app.post("/add-pet", verifyToken, async (req, res) => {
            const pet = req.body;
            pet.created_at = new Date().toISOString();
            const result = await petCollection.insertOne(pet);
            res.send(result);
        });

        const paginateCollection = require("./utils/pagination__collection.js");

        // GET API endpoint for Retrieving All pets with pagination
        app.get("/all-pets", async (req, res) => {
            const filter = { adopted: false };

            const { category, search } = req.query;
            if (category) {
                const normalize = (str) => str?.toString().toLowerCase().replace(/\s|_/g, "").trim();
                const catNorm = normalize(category);
                filter.$expr = {
                    $eq: [
                        {
                            $replaceAll: {
                                input: {
                                    $replaceAll: { input: { $toLower: "$category" }, find: "_", replacement: "" },
                                },
                                find: " ",
                                replacement: "",
                            },
                        },
                        catNorm,
                    ],
                };
            }
            if (search) {
                filter.pet_name = { $regex: search, $options: "i" };
            }

            const result = await paginateCollection({ collection: petCollection, req, filter });
            res.send({
                pets: result.items,
                nextId: result.nextId,
                previousId: result.previousId,
                total: result.total,
            });
        });

        // GET API endpoint for pets by category
        app.get("/category-pets", async (req, res) => {
            const { category } = req.query;
            if (!category) {
                return res.status(400).send({ success: false, message: "Category is required" });
            }
            try {
                // Use case-insensitive regex for category match
                const filter = {
                    category: { $regex: `^${category}$`, $options: "i" },
                    adopted: false,
                };

                const result = await paginateCollection({ collection: petCollection, req, filter });
                res.send({
                    pets: result.items,
                    nextId: result.nextId,
                    previousId: result.previousId,
                    total: result.total,
                });
            } catch (error) {
                res.status(500).send({ success: false, message: "Failed to fetch pets", error: error.message });
            }
        });

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
    }
}
run();

// Basic route
app.get("/", (req, res) => {
    res.send("AdoptiPet Server is running!");
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
