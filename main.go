package main

import (
	"html/template"
	"log"
	"net/http"
)

var templates *template.Template

func main() {
	var err error
	templates, err = template.ParseGlob("templates/*.html")
	if err != nil {
		log.Fatalf("Error parsing templates: %v", err)
	}

	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))
	http.HandleFunc("/", homeHandler)
	http.HandleFunc("/book", bookHandler)
	http.HandleFunc("/submit-booking", submitBookingHandler)

	log.Println("Server running at http://localhost:8080")
	err = http.ListenAndServe(":8080", nil)
	if err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func homeHandler(w http.ResponseWriter, r *http.Request) {
	err := templates.ExecuteTemplate(w, "home.html", nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func bookHandler(w http.ResponseWriter, r *http.Request) {
	err := templates.ExecuteTemplate(w, "book.html", nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
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
