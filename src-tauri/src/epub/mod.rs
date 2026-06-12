mod builder;
mod templates;

pub use builder::EpubBuilder;
pub(crate) use builder::{available_epub_output_path, APPLE_BOOKS_MAX_INTERNAL_IMAGE_PIXELS};
