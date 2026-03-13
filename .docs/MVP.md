# Core MVP

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
    - The rated books are saved in a list for readers to review, change ratings, remove ratings before submiting. Should be quite inconspiquos, but discoverable.
    - After at least 10 books user can submit and get initial recommendations by submiting
- Fun Loading screen/progress bar (this might take a little, hard to judge atm)
- A list with 10 book recommendations
    - the books shoudl show title, author, year, cover image, short summary
    - There should be a way to parse if readers found a boo kthey want to read (maybe by marking interest)
- Ability to register to save the ratings and results and later add more ratings

Objects:
Books: title, author, year, cover image, short summary
Reader: Nickname, email, password, book ratings, pinned books (to read)