import type { Book } from '$lib/types/book';

/**
 * Dummy book data for starter list and search. Replace with API (e.g. Google Books) later.
 */
export const dummyBooks: Book[] = [
	{
		id: '1',
		book_id: 'DUMMY-1',
		title: 'The Great Gatsby',
		author: 'F. Scott Fitzgerald',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'A story of decadence and the American Dream in the Jazz Age.'
	},
	{
		id: '2',
		book_id: 'DUMMY-2',
		title: 'To Kill a Mockingbird',
		author: 'Harper Lee',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'A young girl in the South witnesses racial injustice.'
	},
	{
		id: '3',
		book_id: 'DUMMY-3',
		title: '1984',
		author: 'George Orwell',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'A dystopian novel about totalitarianism and surveillance.'
	},
	{
		id: '4',
		book_id: 'DUMMY-4',
		title: 'Pride and Prejudice',
		author: 'Jane Austen',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Elizabeth Bennet navigates society and love in Regency England.'
	},
	{
		id: '5',
		book_id: 'DUMMY-5',
		title: 'The Catcher in the Rye',
		author: 'J.D. Salinger',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Holden Caulfield wanders New York after leaving school.'
	},
	{
		id: '6',
		book_id: 'DUMMY-6',
		title: "Harry Potter and the Philosopher's Stone",
		author: 'J.K. Rowling',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'A young wizard discovers his destiny at Hogwarts.'
	},
	{
		id: '7',
		book_id: 'DUMMY-7',
		title: 'The Hobbit',
		author: 'J.R.R. Tolkien',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Bilbo Baggins is swept into an adventure with dwarves.'
	},
	{
		id: '8',
		book_id: 'DUMMY-8',
		title: 'Fahrenheit 451',
		author: 'Ray Bradbury',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'A fireman who burns books questions his role in society.'
	},
	{
		id: '9',
		book_id: 'DUMMY-9',
		title: 'Jane Eyre',
		author: 'Charlotte Brontë',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'An orphan becomes a governess and finds love and independence.'
	},
	{
		id: '10',
		book_id: 'DUMMY-10',
		title: 'The Lord of the Rings',
		author: 'J.R.R. Tolkien',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Frodo must destroy the One Ring in the fires of Mount Doom.'
	},
	{
		id: '11',
		book_id: 'DUMMY-11',
		title: 'Animal Farm',
		author: 'George Orwell',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Farm animals revolt against their human owner.'
	},
	{
		id: '12',
		book_id: 'DUMMY-12',
		title: 'Brave New World',
		author: 'Aldous Huxley',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'A futuristic society where happiness is engineered.'
	},
	{
		id: '13',
		book_id: 'DUMMY-13',
		title: "The Handmaid's Tale",
		author: 'Margaret Atwood',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Offred navigates a theocratic regime in Gilead.'
	},
	{
		id: '14',
		book_id: 'DUMMY-14',
		title: 'Dune',
		author: 'Frank Herbert',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Paul Atreides becomes embroiled in desert politics on Arrakis.'
	},
	{
		id: '15',
		book_id: 'DUMMY-15',
		title: 'The Alchemist',
		author: 'Paulo Coelho',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'A shepherd boy pursues his personal legend.'
	},
	{
		id: '16',
		book_id: 'DUMMY-16',
		title: 'One Hundred Years of Solitude',
		author: 'Gabriel García Márquez',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'The Buendía family and the town of Macondo across generations.'
	},
	{
		id: '17',
		book_id: 'DUMMY-17',
		title: 'Beloved',
		author: 'Toni Morrison',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Sethe is haunted by the ghost of her baby in post-Civil War Ohio.'
	},
	{
		id: '18',
		book_id: 'DUMMY-18',
		title: 'The Kite Runner',
		author: 'Khaled Hosseini',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Amir seeks redemption for betraying his friend Hassan.'
	},
	{
		id: '19',
		book_id: 'DUMMY-19',
		title: 'Slaughterhouse-Five',
		author: 'Kurt Vonnegut',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Billy Pilgrim becomes unstuck in time.'
	},
	{
		id: '20',
		book_id: 'DUMMY-20',
		title: 'The Road',
		author: 'Cormac McCarthy',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'A father and son journey through a post-apocalyptic America.'
	},
	{
		id: '21',
		book_id: 'DUMMY-21',
		title: 'Where the Crawdads Sing',
		author: 'Delia Owens',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Kya Clark grows up alone in the marshes of North Carolina.'
	},
	{
		id: '22',
		book_id: 'DUMMY-22',
		title: 'Educated',
		author: 'Tara Westover',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'A memoir of growing up without formal education and finding a way out.'
	},
	{
		id: '23',
		book_id: 'DUMMY-23',
		title: 'Project Hail Mary',
		author: 'Andy Weir',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'An astronaut wakes alone on a spaceship with no memory of his mission.'
	},
	{
		id: '24',
		book_id: 'DUMMY-24',
		title: 'The Midnight Library',
		author: 'Matt Haig',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Nora finds a library between life and death where she can try other lives.'
	},
	{
		id: '25',
		book_id: 'DUMMY-25',
		title: 'Normal People',
		author: 'Sally Rooney',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Connell and Marianne navigate love and class from school to university.'
	},
	{
		id: '26',
		book_id: 'DUMMY-26',
		title: 'Klara and the Sun',
		author: 'Kazuo Ishiguro',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'An AI companion observes human love and sacrifice.'
	},
	{
		id: '27',
		book_id: 'DUMMY-27',
		title: 'Piranesi',
		author: 'Susanna Clarke',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'Piranesi lives in a vast house of endless halls and tides.'
	},
	{
		id: '28',
		book_id: 'DUMMY-28',
		title: 'A Gentleman in Moscow',
		author: 'Amor Towles',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'A count is confined to a hotel for decades after the Russian Revolution.'
	},
	{
		id: '29',
		book_id: 'DUMMY-29',
		title: 'The Seven Husbands of Evelyn Hugo',
		author: 'Taylor Jenkins Reid',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'A reclusive star tells her life story to a young journalist.'
	},
	{
		id: '30',
		book_id: 'DUMMY-30',
		title: 'Circe',
		author: 'Madeline Miller',
		coverUrl: 'https://covers.openlibrary.org/b/id/240727-M.jpg',
		summary: 'The witch Circe tells her story from the Odyssey.'
	}
];

/** Fallback lookup when a rated book is not in the current browse/search lists. */
export function getBookById(id: string): Book | undefined {
	return dummyBooks.find((b) => b.id === id);
}
