import express from "express";
import dotenv from "dotenv";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import GoogleStrategy from "passport-google-oauth2";
import { v7 as uuidv7 } from "uuid";
//env import
dotenv.config();

// port and app
const app = express();
const Port = process.env.PORT;
const saltRounds = 10;

//db connection
const db = new pg.Pool({
  user: process.env.local_db_user,
  password: process.env.local_db_password,
  host: process.env.local_db_host,
  database: process.env.local_db_name,
  port: process.env.local_db_port,
});

const PgSession = connectPgSimple(session);

//middleware

//session cookies middleware
app.use(
  session({
    store: new PgSession({
      pool: db,
      tableName: "session",
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24,
      sameSite: "lax",
    },
  }),
);

app.use(passport.initialize());
//passport session middleware
app.use(passport.session());

app.use(express.static("public")); //get styles
app.use(express.static("node_modules")); //serve npm packages
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set("view engine", "ejs"); //set ejs template engine
app.set("views", "./views"); //set views directory

//get home page
app.get("/", async (req, res) => {
  res.render("home");
});

//get register page
app.get("/register", async (req, res) => {
  res.render("register");
});

//get login page
app.get("/login", async (req, res) => {
  res.render("login");
});

//get library page route
app.get("/library", requireAuth, async (req, res) => {
  res.set("Cache-Control", "no-store");

  let booklist = [];
  try {
    const result = await db.query(
      "SELECT * FROM books WHERE uuid=$1 ORDER BY book_id DESC",
      [req.user.uuid],
    );
    booklist = result.rows;
  } catch (error) {
    console.error("ERROR: ", error);
  }
  res.render("library", { booklist: booklist });
});

//getting stored olid to reduce the requests on book details API in the openlibrary API
app.get("/getolid/:bookName", requireAuth, async (req, res) => {
  const title = req.params.bookName;
  let response = [];
  try {
    response = (
      await db.query("SELECT olid FROM books WHERE title=$1", [title])
    ).rows;
  } catch (error) {
    console.log("ERROR: ", error);
  }
  res.send(response);
});

//submit new book
app.post("/submit", requireAuth, async (req, res) => {
  const requestBody = req.body;
  const title = requestBody.title;
  const description = requestBody.description;
  const read_status = false;
  const isbn = requestBody.isbn || null;
  const publishYear = Number(requestBody.publish_year) || null;
  const mediaType = requestBody.media_type;
  const author = requestBody.author;
  const useruuid = req.user.uuid;
  try {
    await db.query(
      "INSERT INTO books (title,description,isbn,read_status,publish_year,media_type,author,uuid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        title,
        description,
        isbn,
        read_status,
        publishYear,
        mediaType,
        author,
        useruuid,
      ],
    );

    res.redirect("/library");
  } catch (error) {
    console.log("ERROR: ", error);
  }
});

//update read status (read or unread)
app.patch("/read_status", requireAuth, async (req, res) => {
  const bookId = req.body.bookId;
  const status = req.body.status;

  try {
    await db.query("UPDATE books SET read_status=$1 WHERE book_id=$2", [
      status,
      bookId,
    ]);
    res.json({ success: true, message: "book status updated" });
  } catch (error) {
    console.log("ERROR:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

//save olid to db
app.patch("/saveolid", requireAuth, async (req, res) => {
  const bookId = req.body.bookId;
  const olid = req.body.olid;
  try {
    await db.query("UPDATE books SET olid=$1 WHERE book_id =$2", [
      olid,
      bookId,
    ]);
    res.json({ success: true, message: "olid saved" });
  } catch (error) {
    console.log("ERROR: ", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

//user register
app.post("/register", async (req, res) => {
  const userName = req.body.userName;
  const userEmail = req.body.userEmail;

  try {
    const userPassword = await bcrypt.hash(req.body.userPassword, saltRounds);
    const result = await db.query(
      "INSERT INTO users (name,email,password,uuid) VALUES($1,$2,$3,$4)",
      [userName, userEmail, userPassword, uuidv7()],
    );
    res.redirect("/login");
  } catch (err) {
    if (err.code === "23505") {
      res.status(400).json("Email already registered");
    } else {
      res.status(500).json("Error: user unable to register");
    }
  }
});

//user login
app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/library",
    failureRedirect: "/login",
  }),
);

//cookie consent this is Work In Progress
app.post("/accept-cookies", (req, res) => {
  req.session.consentGiven = true; // first write -> session now gets created
  res.sendStatus(200);
});

app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    res.redirect("/login");
  });
});

//
app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  }),
);
app.get(
  "/auth/google/library",
  passport.authenticate("google", {
    successRedirect: "/library",
    failureRedirect: "/",
  }),
);

//passport local login strategy middleware
passport.use(
  "local",
  new Strategy(
    { usernameField: "userEmail", passwordField: "userPassword" },
    async function (username, password, cb) {
      try {
        const result = await db.query(
          "SELECT email,password ,uuid FROM users WHERE email=$1",
          [username],
        );
        if (result.rows.length > 0) {
          const user = result.rows[0];
          const passwordHashed = user.password;

          bcrypt.compare(password, passwordHashed, (err, valid) => {
            if (err) {
              return cb(err);
            } else {
              if (valid) {
                return cb(null, user);
              } else {
                return cb(null, false);
              }
            }
          });
        } else {
          return cb(null, false, { message: "check email or password" });
        }
      } catch (err) {
        return cb(err);
      }
    },
  ),
);

//google login strategy
passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.REDIRECT_URI,
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, cb) => {
      try {
        const result = await db.query("SELECT * FROM users WHERE email=$1", [
          profile.email,
        ]);
        if (result.rows.length == 0) {
          const newUser = await db.query(
            "INSERT INTO users (name,email,password,uuid) VALUES ($1,$2,$3,$4)RETURNING *",
            [profile.displayName, profile.email, "googleAuth", uuidv7()],
          );
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    },
  ),
);

passport.serializeUser(async (user, cb) => cb(null, user.email));

passport.deserializeUser(async (email, cb) => {
  try {
    const result = await db.query(
      "SELECT uuid, name, email FROM users WHERE email=$1",
      [email],
    );
    cb(null, result.rows[0]);
  } catch (err) {
    cb(err);
  }
});

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

//app activate
app.listen(Port, () => {
  console.log("App listening to port: ", Port);
});
