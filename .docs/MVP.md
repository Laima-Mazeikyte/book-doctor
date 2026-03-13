# MVP plan

## Concept

I am going to build a web app that gives readers highly personalized book recommendations using a custom ML model we currently call Book Doctor.

Finding the right book to read is hard, and current services are not great at matching unique, specific tastes (based on personal experience). This app aims to fix this: users will rate at least 10 books they have read, and Book Doctor will suggests what users should try next. The goal of this early version is to test the model with real readers to see if they actually enjoy the suggestions.

## Core features

List the 2–3 features that make up your minimum viable app. These are the things that need to work for the app to be useful. Be specific.

- Search books by title/author
- Rating books from 1-5. Ability to remove and edit the ratings before submitting and a clear way to track what you’ve already rated.
- A list with 10 book recommendations.

## Nice-to-haves

- FAQ/About page
    - It is not an LLM but a deterministic model → you will get the same result if you select the same books with exactly the same rating.
    - It is a Two-Towers data model and takes 18 different things into consideration to provide the best possible recommendation.
    - The model creates up to 3 distinct profiles for readers to show a wider variety of books (e.g. if you enjoy sci-fi and historical memoirs, books like these are unlikely to ever overlap, but the recommendation model will include books from both of these areas based on what you’ve rated)
- Sign up/Log in to save results or edit them.

## Future ideas

- Prompt readers to compare books they’ve rated (Book1 vs Book2) to improve recommendation results.
- Pin books as ‘wish to read’
- Importing ratings from goodreads account
- Type in a book and it shows if you are likely to like it according to your profile (`Book Doctor` supports that)
- Groups of readers can build a shared recommendation list (would be great for book clubs).

## Structure 

- Landing page
    - Life's too short for [insert adjective] books. the adjectives will be revolving and changing, as different people like diffrent books 
    - Importing book ratings CSV from goodreads?
    - Starting the book rating flow
    - FAQ / About

- Book rating flow:
    - A initial commonly read book list with Active Recommender Loop
        - the list updates with each rating and new, more relevant book appear (this is to help users rate without having to remember and search each book)
    - Search books (with Google Book API or Open Books API)
        - Searching by title/author and retrieving book metadata
    - Rating books from 1-5.
    - The rated books are saved in a list for readers to review, change ratings, remove ratings before submiting. Should be  discoverable but not 'in your face'
    - After at least 10 books user can submit and get initial recommendations by submiting

- Loading screen/progress bar (this might take a little, hard to judge atm)

- A list with 10 book recommendations
    - the books should show title, author, year, cover image, short summary
    - There should be a way to parse if readers found book they want to read (maybe by marking interest)
    
- Ability to register to save the ratings and results and later add more ratings
