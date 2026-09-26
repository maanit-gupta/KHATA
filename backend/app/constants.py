"""Locked values from CLAUDE.md §2 and §9b."""

LANGS = ("ta-IN", "hi-IN", "en-IN", "te-IN", "kn-IN", "ml-IN")

# Used until the user picks a voice in Settings (tts_voice is null until then).
DEFAULT_VOICE = {"ta-IN": "ratan", "hi-IN": "shubh", "en-IN": "ratan",
                 "te-IN": "shubh", "kn-IN": "shubh", "ml-IN": "shubh"}

# bulbul:v3 speakers (docs/sarvam-notes.md), minus `varun`, which is hidden from the picker.
VOICES = ("shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan", "simran",
          "kavya", "amit", "dev", "ishita", "shreya", "ratan", "manan", "sumit", "roopa",
          "kabir", "aayan", "ashutosh", "advait", "anand", "tanya", "tarun", "sunny", "mani",
          "gokul", "vijay", "shruti", "suhani", "mohit", "kavitha", "rehan", "soham", "rupali")
