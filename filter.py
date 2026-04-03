import os
import json
import string

def process_dictionary(input_file, output_dir):
    # Create output directory if it doesn't exist
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # Define strict English lowercase alphabet (a-z)
    allowed_chars = set(string.ascii_lowercase)
    unique_words = set()

    print(f"Reading {input_file}...")
    
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            for line in f:
                parts = line.strip().split()
                if not parts:
                    continue
                
                word = parts[0].lower()

                # NEW STRICT FILTER: 
                # 1. Word must not be empty
                # 2. Every single character must be in our a-z set
                if word and all(char in allowed_chars for char in word):
                    unique_words.add(word)

        # Group words by length
        length_bins = {}
        for word in unique_words:
            length = len(word)
            if length not in length_bins:
                length_bins[length] = []
            length_bins[length].append(word)

        # Write files
        print(f"Writing files to {output_dir}/...")
        for length, words in length_bins.items():
            words.sort()
            file_name = f"words-{length}.json"
            file_path = os.path.join(output_dir, file_name)
            
            with open(file_path, 'w', encoding='utf-8') as out_file:
                json.dump(words, out_file, indent=2)
            
            print(f" - Created {file_name} ({len(words)} words)")

        print("\nProcessing complete! Accented and non-English characters removed.")

    except FileNotFoundError:
        print(f"Error: Could not find '{input_file}'.")

if __name__ == "__main__":
    process_dictionary('popular.txt', 'dictionaries')