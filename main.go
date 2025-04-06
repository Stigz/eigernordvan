package main

import (
	"html/template"
	"log"
	"net/http"
)

var templates *template.Template

func main() {
	templates = template.Must(template.ParseGlob("templates/*.html"))

	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))
	http.HandleFunc("/", homeHandler)
	http.HandleFunc("/book", bookHandler)
	http.HandleFunc("/submit-booking", submitBookingHandler)

	log.Println("Server running at http://localhost:8080")
	http.ListenAndServe(":8080", nil)
}

func homeHandler(w http.ResponseWriter, r *http.Request) {
	templates.ExecuteTemplate(w, "home.html", nil)
}

func bookHandler(w http.ResponseWriter, r *http.Request) {
	templates.ExecuteTemplate(w, "book.html", nil)
}

func submitBookingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	name := r.FormValue("name")
	email := r.FormValue("email")
	dates := r.FormValue("dates")

	log.Printf("Booking received: %s, %s, %s", name, email, dates)
	http.Redirect(w, r, "/", http.StatusSeeOther)
} 
