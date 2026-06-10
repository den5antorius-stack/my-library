import express from "express";
import dotenv from "dotenv";
import pg from "pg";

//env import
dotenv.config();

// port and app
const app = express();
const Port = process.env.Port;

//middleware

app.use(express.static("public")); //get styles
app.use(express.static("node_modules")); //serve npm packages
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs"); //set ejs template engine
app.set("views", "./views"); //set views directory

//db connection
const db = new pg.Pool({
  user: process.env.local_db_user,
  password: process.env.local_db_password,
  host: process.env.local_db_host,
  database: process.env.local_db_name,
  port: process.env.local_db_port,
});

//get home page route
app.get("/", async (req, res) => {
  let booklist = [];
  try {
    const result = await db.query(
      "SELECT book_id, title, description, read_status, media_type FROM books ORDER BY book_id DESC",
    );
    booklist = result.rows;
    console.log(booklist);
  } catch (error) {
    console.error("ERROR: ", error);
  }
  res.render("index", { booklist: booklist });
});

app.get("/getolid", async (req, res) => {
  const title = req.params.bookName;
  const response = [];
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
app.post("/submit", async (req, res) => {
  const response = req.body;
  console.log(response);
  const title = response.title;
  const description = response.description;
  const read_status = false;
  const isbn = response.isbn || null;
  const publishYear = Number(response.publish_year) || null;
  const mediaType = response.media_type;
  try {
    db.query(
      "INSERT INTO books (title,description,isbn,read_status,publish_year,media_type) VALUES ($1,$2,$3,$4,$5,$6)",
      [title, description, isbn, read_status, publishYear, mediaType],
    );
    res.redirect("/");
  } catch (error) {
    console.log("ERROR: ", error);
  }
});

//update read status (read or unread)
app.patch("/read_status", async (req, res) => {
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
app.patch("/saveolid", async (req, res) => {
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

//app activate
app.listen(Port, () => {
  console.log("App listening to port: ", Port);
});
